'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const {
  matchDeposit,
  isNameMatch,
  createApproval,
} = require('../utils/depositRequests');
const { updateBalance, getBalance } = require('../utils/shopData');
const { createRechargeChannel } = require('./dashboardHandler');

/**
 * 알림 payload를 하나의 문자열로 합칩니다(제목 + 내용 + 원문).
 * @param {unknown} body
 * @returns {string}
 */
function combinedText(body) {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (typeof body === 'object') {
    return [body.title, body.text, body.content, body.message]
      .filter((part) => typeof part === 'string')
      .join(' ');
  }
  return String(body);
}

/**
 * 입금 알림에서 금액(원)을 추출합니다.
 * "3,215원이 입금됐어요." 같은 문자열도 처리합니다.
 * @param {unknown} body
 * @returns {number | null}
 */
function extractAmount(body) {
  if (body && typeof body === 'object') {
    const value = body.amount ?? body.value ?? body.price;
    if (value != null) {
      const direct = Number(String(value).replace(/[^\d]/g, ''));
      if (Number.isSafeInteger(direct) && direct > 0) return direct;
    }
  }

  const text = combinedText(body);
  // "3,215원" 처럼 '원' 바로 앞의 숫자를 우선 인식 (시각 등 다른 숫자 오인 방지)
  const wonMatch = text.match(/([\d,]+)\s*원/);
  const digits = (wonMatch ? wonMatch[1] : text).replace(/[^\d]/g, '');
  if (!digits) return null;

  const amount = Number(digits);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

/**
 * 입금 알림에서 입금자명을 추출합니다. 없으면 null.
 * @param {unknown} body
 * @returns {string | null}
 */
function extractName(body) {
  if (body && typeof body === 'object' && typeof body.name === 'string') {
    const trimmed = body.name.trim();
    if (trimmed) return trimmed;
  }

  const text = combinedText(body);
  // "홍길동님", "홍길동 님이", "홍길동님이 보냈어요" 등에서 이름 추출
  const nameMatch = text.match(/([가-힣]{2,5})\s*님/);
  if (nameMatch) return nameMatch[1];

  return null;
}

/** 매칭/알림을 게시할 길드를 찾습니다. */
function resolveGuild(client) {
  const configuredId = process.env.GUILD_ID?.trim();
  if (configuredId) {
    const guild = client.guilds.cache.get(configuredId);
    if (guild) return guild;
  }
  return client.guilds.cache.first() || null;
}

async function notifyLogChannel(client, message) {
  const channelId = process.env.DEPOSIT_LOG_CHANNEL_ID?.trim();
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    if (channel?.isTextBased()) {
      await channel.send(message);
    }
  } catch (error) {
    console.error('[deposit] log channel notify failed:', error.message);
  }
}

/** 잔액을 충전하고 유저에게 DM을 보냅니다. */
async function creditUser(client, userId, amount, reasonLabel) {
  await updateBalance(userId, 'add', amount);
  const { amount: balance } = await getBalance(userId);

  try {
    const user = await client.users.fetch(userId);
    await user.send(
      [
        `입금이 확인되어 ${reasonLabel} 충전되었습니다.`,
        `충전 금액: **${amount.toLocaleString()}원**`,
        `현재 잔액: **${balance.toLocaleString()}원**`,
      ].join('\n')
    );
  } catch (error) {
    console.error('[deposit] DM to user failed:', error.message);
  }

  return balance;
}

/** 이름 일치 → 자동충전. */
async function handleAutoCharge(client, request, amount) {
  const balance = await creditUser(client, request.userId, amount, '자동으로');
  await notifyLogChannel(
    client,
    `자동충전 완료: <@${request.userId}> (${request.expectedName}) +${amount.toLocaleString()}원 → 잔액 ${balance.toLocaleString()}원`
  );
  console.log(
    `[deposit] auto: user=${request.userId} amount=${amount} balance=${balance}`
  );
}

/**
 * 이름 불일치/누락 → 관리자 승인 대기 티켓 생성.
 */
async function handleNeedsApproval(client, request, amount, detectedName) {
  const token = createApproval({
    userId: request.userId,
    username: request.username,
    amount,
    expectedName: request.expectedName,
    detectedName: detectedName || null,
  });

  await notifyLogChannel(
    client,
    `승인 필요: 입금 ${amount.toLocaleString()}원 / 신청자명 "${request.expectedName}" / 감지된 이름 "${detectedName || '없음'}" — 요청 유저 <@${request.userId}>`
  );

  const guild = resolveGuild(client);
  if (!guild) {
    console.warn('[deposit] approval needed but no guild available.');
    return;
  }

  try {
    const stamp = new Date().toISOString().slice(11, 16).replace(':', '');
    const channel = await createRechargeChannel(guild, {
      name: `승인대기-${amount}-${stamp}`,
      allowUserId: null,
      reason: `입금 승인 확인 ${amount}원`,
    });

    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle('입금 승인 확인 필요')
      .setDescription(
        [
          '금액은 일치하지만 **입금자명이 일치하지 않거나 확인되지 않았습니다.**',
          '토스 앱에서 실제 입금자를 확인한 뒤 승인/거절해 주세요.',
          '',
          `입금 금액: **${amount.toLocaleString()}원**`,
          `요청 유저: <@${request.userId}> (${request.username})`,
          `신청 시 입력한 입금자명: **${request.expectedName}**`,
          `알림에서 감지된 이름: **${detectedName || '없음'}**`,
        ].join('\n')
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`dash|approve|${token}`)
        .setLabel('승인 (충전)')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`dash|reject|${token}`)
        .setLabel('거절')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({ embeds: [embed], components: [row] });
    console.log(
      `[deposit] approval ticket: amount=${amount} user=${request.userId} detected=${detectedName || 'none'}`
    );
  } catch (error) {
    console.error('[deposit] approval ticket creation failed:', error.message);
  }
}

/**
 * 대기 요청이 전혀 없는 미매칭 입금 → 관리자 확인용 티켓.
 */
async function handleMismatch(client, amount, detectedName) {
  await notifyLogChannel(
    client,
    `미매칭 입금: **${amount.toLocaleString()}원** (이름: ${detectedName || '없음'}) — 대기 요청 없음. 수동 확인 필요.`
  );

  const guild = resolveGuild(client);
  if (!guild) {
    console.warn('[deposit] mismatch but no guild available for ticket.');
    return;
  }

  try {
    const stamp = new Date().toISOString().slice(11, 16).replace(':', '');
    const channel = await createRechargeChannel(guild, {
      name: `미매칭입금-${amount}-${stamp}`,
      allowUserId: null,
      reason: `미매칭 입금 ${amount}원 확인`,
    });

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('미매칭 입금 확인 필요')
      .setDescription(
        [
          `입금 금액: **${amount.toLocaleString()}원**`,
          `감지된 이름: **${detectedName || '없음'}**`,
          '',
          '대기중인 충전 요청과 금액이 일치하지 않습니다.',
          '입금자를 확인 후 `/balance` 명령으로 수동 충전해 주세요.',
        ].join('\n')
      );

    await channel.send({ embeds: [embed] });
    console.log(`[deposit] mismatch ticket created for amount=${amount}`);
  } catch (error) {
    console.error('[deposit] mismatch ticket creation failed:', error.message);
  }
}

/**
 * 웹훅으로 들어온 입금 알림을 처리합니다.
 * @param {import('discord.js').Client} client
 * @param {unknown} body 파싱된 JSON 또는 원문 텍스트
 * @returns {Promise<{ ok: boolean, result: string, amount: number | null, name?: string | null }>}
 */
async function processDeposit(client, body) {
  const amount = extractAmount(body);

  if (amount === null) {
    return { ok: false, result: 'amount_not_found', amount: null };
  }

  if (!client?.isReady()) {
    return { ok: false, result: 'client_not_ready', amount };
  }

  const detectedName = extractName(body);
  const request = matchDeposit(amount);

  if (!request) {
    await handleMismatch(client, amount, detectedName);
    return { ok: true, result: 'mismatch', amount, name: detectedName };
  }

  if (isNameMatch(request, detectedName)) {
    await handleAutoCharge(client, request, amount);
    return { ok: true, result: 'charged', amount, name: detectedName };
  }

  await handleNeedsApproval(client, request, amount, detectedName);
  return { ok: true, result: 'needs_approval', amount, name: detectedName };
}

module.exports = {
  processDeposit,
  extractAmount,
  extractName,
};

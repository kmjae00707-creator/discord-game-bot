'use strict';

const { EmbedBuilder } = require('discord.js');
const { matchDeposit } = require('../utils/depositRequests');
const { updateBalance, getBalance } = require('../utils/shopData');
const { createRechargeChannel } = require('./dashboardHandler');

/**
 * 입금 알림 원문/JSON에서 금액(원)을 추출합니다.
 * "3,215원이 입금됐어요." 같은 문자열도 처리합니다.
 * @param {unknown} body
 * @returns {number | null}
 */
function extractAmount(body) {
  if (body == null) return null;

  if (typeof body === 'object') {
    const value = body.amount ?? body.value ?? body.price;
    if (value != null) {
      return extractAmount(value);
    }
    if (typeof body.text === 'string') {
      return extractAmount(body.text);
    }
    return null;
  }

  const digits = String(body).replace(/[^\d]/g, '');
  if (!digits) return null;

  const amount = Number(digits);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

/** 매칭 실패 시 알림을 게시할 길드를 찾습니다. */
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

/**
 * 매칭된 요청에 대해 잔액을 충전하고 유저에게 DM을 보냅니다.
 */
async function handleMatched(client, request, amount) {
  await updateBalance(request.userId, 'add', amount);
  const { amount: balance } = await getBalance(request.userId);

  const dmContent = [
    '입금이 확인되어 자동 충전되었습니다.',
    `충전 금액: **${amount.toLocaleString()}원**`,
    `현재 잔액: **${balance.toLocaleString()}원**`,
  ].join('\n');

  try {
    const user = await client.users.fetch(request.userId);
    await user.send(dmContent);
  } catch (error) {
    console.error('[deposit] DM to user failed:', error.message);
  }

  await notifyLogChannel(
    client,
    `자동충전 완료: <@${request.userId}> +${amount.toLocaleString()}원 (잔액 ${balance.toLocaleString()}원)`
  );

  console.log(
    `[deposit] matched: user=${request.userId} amount=${amount} balance=${balance}`
  );
}

/**
 * 매칭 실패(입금 금액이 대기 요청과 다름) → 관리자 확인용 티켓 채널 생성.
 */
async function handleMismatch(client, amount) {
  await notifyLogChannel(
    client,
    `미매칭 입금 감지: **${amount.toLocaleString()}원** — 대기중인 요청과 일치하지 않습니다. 수동 확인이 필요합니다.`
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
 * @returns {Promise<{ ok: boolean, matched: boolean, amount: number | null, reason?: string }>}
 */
async function processDeposit(client, body) {
  const amount = extractAmount(body);

  if (amount === null) {
    return { ok: false, matched: false, amount: null, reason: 'amount_not_found' };
  }

  if (!client?.isReady()) {
    return { ok: false, matched: false, amount, reason: 'client_not_ready' };
  }

  const request = matchDeposit(amount);

  if (request) {
    await handleMatched(client, request, amount);
    return { ok: true, matched: true, amount };
  }

  await handleMismatch(client, amount);
  return { ok: true, matched: false, amount };
}

module.exports = {
  processDeposit,
  extractAmount,
};

const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { RECHARGE_CATEGORY_ID } = require('../commands/dashboard');
const {
  getProducts,
  getCategories,
  getBalance,
  purchaseProduct,
  updateBalance,
} = require('../utils/shopData');
const {
  deferEphemeral,
  showModal,
} = require('../utils/interactionResponse');
const {
  createRequest,
  resolveApproval,
  REQUEST_TTL_MS,
} = require('../utils/depositRequests');
const {
  getGppoint,
  getSlotGppoint,
  getRobuxStock,
  buyRobux,
  buyGppoint,
  exchangeSlotGppoint,
  WON_PER_GP,
  ROBUX_PER_GP,
  SLOT_GP_PER_GP,
} = require('../utils/gppointData');
const { BALANCE_ADMIN_ID } = require('../commands/balance');
const { writeDataFiles } = require('../utils/dataStore');
const { enqueue } = require('../utils/mutationQueue');
const {
  getNotice,
  getUserRank,
  getPurchaseLogs,
  getRechargeLogs,
  getSoldMap,
  getVerifiedSet,
  getRanks,
  soldKey,
  formatKst,
  buildVerifiedUpdate,
} = require('../utils/userLedger');

// 입금 계좌 안내 문구 (환경 변수로 관리, 미설정 시 기본 안내)
const DEPOSIT_ACCOUNT_INFO =
  process.env.DEPOSIT_ACCOUNT_INFO?.trim() ||
  '입금 계좌 정보가 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.';

const CHARGE_MODAL_ID = 'dash|charge-modal';
const CHARGE_AMOUNT_INPUT_ID = 'amount';
const CHARGE_NAME_INPUT_ID = 'depositor';

// 미매칭 입금 수동 충전 모달 (customId: dash|mfix-modal|<amount>)
const MFIX_MODAL_PREFIX = 'dash|mfix-modal|';
const MFIX_USER_INPUT_ID = 'userid';

// 카테고리 선택 메뉴 / 로벅스 구매 모달
const CAT_VIEW_SELECT = 'dash|catview';
const CAT_BUY_SELECT = 'dash|catbuy';
const INGAME_BUY_SELECT = 'dash|buy';
const PLOG_SELECT = 'dash|plog';
const CLOG_SELECT = 'dash|clog';
const ROBUX_MODAL_ID = 'dash|robux-modal';
const ROBUX_AMOUNT_INPUT_ID = 'robux';
const ROBUX_NICK_INPUT_ID = 'rblxnick';
const ROBUX_PASS_INPUT_ID = 'gamepass';
const GP_MODAL_ID = 'dash|gp-modal';
const GP_AMOUNT_INPUT_ID = 'gpqty';
const EXCHANGE_MODAL_ID = 'dash|gp-exchange-modal';
const EXCHANGE_AMOUNT_INPUT_ID = 'exgp';

async function handleDashboardButton(interaction) {
  const action = interaction.customId.split('|')[1];

  if (action === 'products') {
    await handleProducts(interaction);
    return;
  }

  if (action === 'notice') {
    await handleNotice(interaction);
    return;
  }

  if (action === 'recharge') {
    await handleRechargeModal(interaction);
    return;
  }

  if (action === 'info') {
    await handleInfo(interaction);
    return;
  }

  if (action === 'purchase') {
    await handlePurchaseMenu(interaction);
    return;
  }

  if (action === 'gpbuy') {
    await showGpBuyModal(interaction);
    return;
  }

  if (action === 'gpexchange') {
    await showExchangeModal(interaction);
    return;
  }

  if (action === 'plog') {
    await handlePurchaseLog(interaction);
    return;
  }

  if (action === 'clog') {
    await handleRechargeLog(interaction);
    return;
  }

  if (action === 'ranks') {
    await handleRanks(interaction);
    return;
  }

  if (action === 'verify') {
    await handleVerify(interaction);
    return;
  }

  if (action === 'close') {
    await handleCloseRechargeChannel(interaction);
    return;
  }

  if (action === 'delete') {
    await handleDeleteRechargeChannel(interaction);
    return;
  }

  if (action === 'approve') {
    await handleApproveDeposit(interaction);
    return;
  }

  if (action === 'robuxbuy') {
    await showRobuxBuyModal(interaction);
    return;
  }

  if (action === 'mfix') {
    await handleMismatchFixButton(interaction);
    return;
  }

  if (action === 'mreject') {
    await handleMismatchReject(interaction);
    return;
  }

  if (action === 'reject') {
    await handleRejectDeposit(interaction);
  }
}

async function handleDashboardSelect(interaction) {
  const { customId } = interaction;

  if (customId === CAT_VIEW_SELECT) {
    await handleCategoryView(interaction);
    return;
  }
  if (customId === CAT_BUY_SELECT) {
    await handleCategoryBuy(interaction);
    return;
  }
  if (customId === INGAME_BUY_SELECT) {
    await handleIngameBuySelect(interaction);
    return;
  }
  if (customId === PLOG_SELECT) {
    await handlePurchaseLogSelect(interaction);
    return;
  }
  if (customId === CLOG_SELECT) {
    await handleRechargeLogSelect(interaction);
  }
}

async function handleIngameBuySelect(interaction) {
  const productId = interaction.values[0];
  await deferEphemeral(interaction);

  try {
    const result = await purchaseProduct(interaction.user.id, productId);

    if (result.status === 'not_found') {
      await interaction.editReply({ content: '선택한 제품을 찾을 수 없습니다.' });
      return;
    }

    if (result.status === 'insufficient') {
      const discountLine =
        result.discount > 0
          ? `\n등급 할인 ${result.discount}% 적용가: **${result.price.toLocaleString()}원**`
          : '';
      await interaction.editReply({
        content: `잔액이 부족합니다.\n현재 잔액: **${result.balance.toLocaleString()}원**\n필요 금액: **${result.price.toLocaleString()}원**${discountLine}`,
      });
      return;
    }

    if (result.status === 'out_of_stock') {
      await interaction.editReply({
        content: `**${result.product.name}** 제품이 품절되었습니다. 관리자에게 문의해 주세요.`,
      });
      return;
    }

    try {
      await interaction.user.send(result.product.content);
    } catch {
      await interaction.editReply({
        content:
          '구매는 완료되었지만 DM을 보낼 수 없습니다. Discord 설정에서 DM을 허용해 주세요.',
      });
      return;
    }

    await interaction.editReply({
      content: [
        `**${result.product.name}** 구매 완료!`,
        result.discount > 0
          ? `결제: **${result.price.toLocaleString()}원** (${result.discount}% 할인)`
          : `결제: **${result.price.toLocaleString()}원**`,
        `남은 잔액: **${result.balance.toLocaleString()}원**`,
        '제품 내용을 DM으로 보냈습니다.',
      ].join('\n'),
    });
  } catch (error) {
    console.error('[dashboard] purchase error:', error);
    await interaction.editReply({
      content: '구매 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    });
  }
}

/** 카테고리 선택 메뉴를 만듭니다. 로벅스 + GitHub 카테고리. */
async function buildCategoryMenu(customId) {
  const { products } = await getProducts();
  const categories = getCategories(products).filter((item) => item.name !== '로벅스');
  const { stock } = await getRobuxStock();

  const options = [
    {
      label: '로벅스',
      description: `1개 제품 · 재고 ${stock.toLocaleString()}`,
      value: 'robux',
    },
    ...categories.slice(0, 24).map((category) => ({
      label: category.name.slice(0, 100),
      description: `${category.count}개 제품`.slice(0, 100),
      value: category.name.slice(0, 100),
    })),
  ];

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('카테고리를 선택하세요')
    .addOptions(options);
  return new ActionRowBuilder().addComponents(menu);
}

function stockLabel(product, sold) {
  const stockText = product.unlimited ? '무제한' : `${product.stock}개`;
  return `${stockText} / 판매 ${sold}회`;
}

async function handleNotice(interaction) {
  await deferEphemeral(interaction);
  try {
    const notice = await getNotice();
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📢 공지사항')
      .setDescription(notice.slice(0, 4096));
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[dashboard] notice error:', error);
    await interaction.editReply({ content: '공지를 불러오지 못했습니다.' });
  }
}

async function handleProducts(interaction) {
  await deferEphemeral(interaction);
  try {
    const { products } = await getProducts();
    const categories = getCategories(products);
    const lines = [
      '조회하실 카테고리를 선택해 주세요.',
      '',
      '• 로벅스 : 1개',
      ...categories.map((category) => `• ${category.name} : ${category.count}개`),
    ];
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('카테고리 선택')
      .setDescription(lines.join('\n'));
    await interaction.editReply({
      embeds: [embed],
      components: [await buildCategoryMenu(CAT_VIEW_SELECT)],
    });
  } catch (error) {
    console.error('[dashboard] products error:', error);
    await interaction.editReply({ content: '카테고리를 불러오지 못했습니다.' });
  }
}

async function handlePurchaseMenu(interaction) {
  await deferEphemeral(interaction);
  try {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🛒 카테고리 선택')
      .setDescription('구매할 카테고리를 선택해 주세요.');
    await interaction.editReply({
      embeds: [embed],
      components: [await buildCategoryMenu(CAT_BUY_SELECT)],
    });
  } catch (error) {
    console.error('[dashboard] purchase menu error:', error);
    await interaction.editReply({ content: '카테고리를 불러오지 못했습니다.' });
  }
}

async function handleCategoryView(interaction) {
  await deferEphemeral(interaction);
  const category = interaction.values[0];

  if (category === 'robux') {
    await showRobuxInfo(interaction);
    return;
  }
  await showCategoryProductList(interaction, category);
}

async function handleCategoryBuy(interaction) {
  await deferEphemeral(interaction);
  const category = interaction.values[0];

  if (category === 'robux') {
    await showRobuxBuyPrompt(interaction);
    return;
  }
  await showIngameBuyMenu(interaction, category);
}

async function showCategoryProductList(interaction, category) {
  try {
    const { products } = await getProducts();
    const soldMap = await getSoldMap();
    const items = products.filter((product) => product.category === category);

    if (items.length === 0) {
      await interaction.editReply({ content: '이 카테고리에 제품이 없습니다.', components: [] });
      return;
    }

    const list = items
      .map((product) => {
        const sold = soldMap.get(soldKey(product)) || 0;
        return [
          `• 제품명: **${product.name}**`,
          `• 가격: ${product.price.toLocaleString()}원`,
          `• 재고: ${stockLabel(product, sold)}`,
        ].join('\n');
      })
      .join('\n\n');

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${category} 제품 목록 (1/1)`)
      .setDescription(list.slice(0, 4096));

    await interaction.editReply({ embeds: [embed], components: [] });
  } catch (error) {
    console.error('[dashboard] category list error:', error);
    await interaction.editReply({ content: '제품 목록을 불러오지 못했습니다.', components: [] });
  }
}

// 로벅스 안내(환율/재고)
async function showRobuxInfo(interaction) {
  try {
    const { amount: gp } = await getGppoint(interaction.user.id);
    const { stock } = await getRobuxStock();

    const embed = new EmbedBuilder()
      .setColor(0xfaa61a)
      .setTitle('로벅스')
      .setDescription(
        [
          `• 제품명: **로벅스**`,
          `• 가격: **1 gppoint = ${ROBUX_PER_GP} 로벅스 (${WON_PER_GP}원)**`,
          `• 재고: ${stock.toLocaleString()} / gppoint로 구매`,
          `• 내 gppoint: **${gp.toLocaleString()} gp**`,
        ].join('\n')
      );

    await interaction.editReply({ embeds: [embed], components: [] });
  } catch (error) {
    console.error('[dashboard] robux info error:', error);
    await interaction.editReply({ content: '로벅스 정보를 불러오지 못했습니다.', components: [] });
  }
}

// 로벅스 구매 안내(모달은 버튼으로) — 구매 수량 입력 모달 트리거 버튼 제공
async function showRobuxBuyPrompt(interaction) {
  const { amount: gp } = await getGppoint(interaction.user.id);
  const { stock } = await getRobuxStock();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('dash|robuxbuy')
      .setLabel('구매 수량 입력')
      .setEmoji('💰')
      .setStyle(ButtonStyle.Success)
  );

  const embed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle('로벅스 구매')
    .setDescription(
      [
        `내 gppoint: **${gp.toLocaleString()} gp** / 재고: **${stock.toLocaleString()} 로벅스**`,
        `**1 gppoint = ${ROBUX_PER_GP} 로벅스 (${WON_PER_GP}원)**`,
        '',
        '아래 버튼을 눌러 구매할 로벅스 수량을 입력하세요.',
      ].join('\n')
    );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

/**
 * 충전 카테고리 안에 문의/티켓용 채널을 생성합니다.
 * allowUserId가 있으면 해당 유저만, 없으면 관리자(+봇)만 볼 수 있습니다.
 * @param {import('discord.js').Guild} guild
 * @param {{ name: string, allowUserId?: string | null, reason?: string }} options
 */
async function createRechargeChannel(guild, { name, allowUserId = null, reason }) {
  const permissionOverwrites = [
    {
      id: guild.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: guild.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];

  if (allowUserId) {
    permissionOverwrites.push({
      id: allowUserId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: RECHARGE_CATEGORY_ID,
    permissionOverwrites,
    reason,
  });
}

/**
 * 충전 버튼 → 금액 입력 모달을 띄웁니다.
 */
async function handleRechargeModal(interaction) {
  if (!interaction.inGuild()) {
    await deferEphemeral(interaction);
    await interaction.editReply({
      content: '서버에서만 충전을 진행할 수 있습니다.',
    });
    return;
  }

  await showModal(interaction, {
    custom_id: CHARGE_MODAL_ID,
    title: '충전 신청',
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: CHARGE_AMOUNT_INPUT_ID,
            label: '충전할 금액 (원)',
            style: 1,
            min_length: 2,
            max_length: 9,
            placeholder: '예: 3000',
            required: true,
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: CHARGE_NAME_INPUT_ID,
            label: '입금자명 (실제 보내는 사람 이름)',
            style: 1,
            min_length: 2,
            max_length: 20,
            placeholder: '예: 홍길동',
            required: true,
          },
        ],
      },
    ],
  });
}

/**
 * 충전 금액 모달 제출 처리 → 고유 입금 금액 배정 후 안내.
 */
async function handleChargeModalSubmit(interaction) {
  await deferEphemeral(interaction);

  const raw = interaction.fields.getTextInputValue(CHARGE_AMOUNT_INPUT_ID);
  const depositorName = interaction.fields.getTextInputValue(CHARGE_NAME_INPUT_ID);
  const requestedAmount = Number(raw.replace(/[,\s원]/g, ''));

  if (!Number.isSafeInteger(requestedAmount) || requestedAmount <= 0) {
    await interaction.editReply({
      content: '올바른 금액을 숫자로 입력해 주세요. (예: 3000)',
    });
    return;
  }

  const result = createRequest(
    interaction.user.id,
    interaction.user.username,
    requestedAmount,
    depositorName
  );

  if (result.status === 'invalid') {
    await interaction.editReply({
      content: '올바른 금액을 입력해 주세요.',
    });
    return;
  }

  if (result.status === 'invalid_name') {
    await interaction.editReply({
      content: '입금자명을 2글자 이상 정확히 입력해 주세요.',
    });
    return;
  }

  if (result.status === 'full') {
    await interaction.editReply({
      content:
        '현재 요청이 많아 고유 금액을 배정하지 못했습니다. 금액을 조금 바꿔서 다시 시도해 주세요.',
    });
    return;
  }

  const { depositAmount, expectedName } = result.request;
  const minutes = Math.round(REQUEST_TTL_MS / 60000);

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('입금 대기중')
    .setDescription(
      [
        '아래 **정확한 금액**을 **입력한 입금자명 그대로** 입금해 주세요.',
        '금액이나 이름이 다르면 자동 충전되지 않고 관리자 확인으로 넘어갑니다.',
        '',
        `**입금 금액: ${depositAmount.toLocaleString()}원**`,
        `**입금자명: ${expectedName}**`,
        '',
        '**입금 계좌**',
        DEPOSIT_ACCOUNT_INFO,
        '',
        `입금이 확인되면 자동으로 충전되고 DM으로 알려드립니다. (유효 시간: ${minutes}분)`,
      ].join('\n')
    );

  await interaction.editReply({ embeds: [embed] });
}

async function handleCloseRechargeChannel(interaction) {
  const ownerId = interaction.customId.split('|')[2];
  const canManageChannel = interaction.memberPermissions?.has(
    PermissionFlagsBits.ManageChannels
  );

  if (interaction.user.id !== ownerId && !canManageChannel) {
    await deferEphemeral(interaction);
    await interaction.editReply({
      content: '충전 채널을 만든 사용자 또는 관리자만 닫을 수 있습니다.',
    });
    return;
  }

  await deferEphemeral(interaction);

  try {
    await interaction.channel.permissionOverwrites.delete(
      ownerId,
      `충전 문의 닫기: ${interaction.user.tag}`
    );
    await interaction.editReply({
      content: '충전 채널 접근 권한이 제거되었습니다.',
    });
  } catch (error) {
    console.error('[dashboard] close channel error:', error);
    await interaction.editReply({
      content: '채널을 닫지 못했습니다. 관리자에게 문의해 주세요.',
    });
  }
}

async function handleDeleteRechargeChannel(interaction) {
  const isAdministrator = interaction.memberPermissions?.has(
    PermissionFlagsBits.Administrator
  );

  if (!isAdministrator) {
    await deferEphemeral(interaction);
    await interaction.editReply({
      content: '관리자만 충전 채널을 삭제할 수 있습니다.',
    });
    return;
  }

  await deferEphemeral(interaction);
  await interaction.editReply({
    content: '충전 채널을 삭제합니다.',
  });

  setTimeout(() => {
    interaction.channel
      ?.delete(`관리자 채널 삭제: ${interaction.user.tag}`)
      .catch((error) => console.error('[dashboard] delete channel error:', error));
  }, 1_500);
}

async function handleApproveDeposit(interaction) {
  const token = interaction.customId.split('|')[2];
  const isAdministrator = interaction.memberPermissions?.has(
    PermissionFlagsBits.Administrator
  );

  await deferEphemeral(interaction);

  if (!isAdministrator) {
    await interaction.editReply({ content: '관리자만 승인할 수 있습니다.' });
    return;
  }

  const approval = resolveApproval(token);
  if (!approval) {
    await interaction.editReply({
      content: '이미 처리되었거나 만료된 승인 요청입니다.',
    });
    return;
  }

  try {
    await updateBalance(approval.userId, 'add', approval.amount, {
      rechargeType: '계좌충전',
    });
    const { amount: balance } = await getBalance(approval.userId);

    try {
      const user = await interaction.client.users.fetch(approval.userId);
      await user.send(
        [
          '입금이 관리자 승인으로 충전되었습니다.',
          `충전 금액: **${approval.amount.toLocaleString()}원**`,
          `현재 잔액: **${balance.toLocaleString()}원**`,
        ].join('\n')
      );
    } catch {
      /* DM 실패는 무시 */
    }

    await interaction.editReply({
      content: `승인 완료: <@${approval.userId}> +${approval.amount.toLocaleString()}원 (잔액 ${balance.toLocaleString()}원)`,
    });

    await interaction.message
      ?.edit({
        components: [],
      })
      .catch(() => {});
  } catch (error) {
    console.error('[dashboard] approve error:', error);
    await interaction.editReply({
      content: '승인 처리 중 오류가 발생했습니다.',
    });
  }
}

async function handleRejectDeposit(interaction) {
  const token = interaction.customId.split('|')[2];
  const isAdministrator = interaction.memberPermissions?.has(
    PermissionFlagsBits.Administrator
  );

  await deferEphemeral(interaction);

  if (!isAdministrator) {
    await interaction.editReply({ content: '관리자만 거절할 수 있습니다.' });
    return;
  }

  const approval = resolveApproval(token);
  if (!approval) {
    await interaction.editReply({
      content: '이미 처리되었거나 만료된 승인 요청입니다.',
    });
    return;
  }

  await interaction.editReply({
    content: `거절 처리했습니다. (입금 ${approval.amount.toLocaleString()}원, 요청 유저 <@${approval.userId}>)`,
  });

  await interaction.message?.edit({ components: [] }).catch(() => {});
}

/** 로벅스 구매 수량 + 닉 + 게임패스 링크 모달. */
async function showRobuxBuyModal(interaction) {
  await showModal(interaction, {
    custom_id: ROBUX_MODAL_ID,
    title: '로벅스 구매',
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: ROBUX_AMOUNT_INPUT_ID,
            label: '구매할 로벅스 수량',
            style: 1,
            min_length: 1,
            max_length: 9,
            placeholder: '예: 100',
            required: true,
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: ROBUX_NICK_INPUT_ID,
            label: '로블록스 닉네임',
            style: 1,
            min_length: 3,
            max_length: 32,
            placeholder: '예: MyRobloxName',
            required: true,
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: ROBUX_PASS_INPUT_ID,
            label: '게임패스 링크',
            style: 1,
            min_length: 12,
            max_length: 300,
            placeholder: 'https://www.roblox.com/game-pass/...',
            required: true,
          },
        ],
      },
    ],
  });
}

function isGamePassLink(raw) {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    if (host !== 'roblox.com' && !host.endsWith('.roblox.com')) return false;
    const hay = `${url.pathname}${url.search}`.toLowerCase();
    return (
      hay.includes('game-pass') ||
      hay.includes('gamepass') ||
      hay.includes('/store/')
    );
  } catch {
    return false;
  }
}

/** 로벅스 구매 모달 제출 → gppoint 차감 + 재고 차감 후 관리자 DM. */
async function handleRobuxModalSubmit(interaction) {
  await deferEphemeral(interaction);

  const raw = interaction.fields.getTextInputValue(ROBUX_AMOUNT_INPUT_ID);
  const robloxNick = interaction.fields.getTextInputValue(ROBUX_NICK_INPUT_ID).trim();
  const gamePassLink = interaction.fields.getTextInputValue(ROBUX_PASS_INPUT_ID).trim();
  const robuxAmount = Number(raw.replace(/[,\s]/g, ''));

  if (!Number.isSafeInteger(robuxAmount) || robuxAmount <= 0) {
    await interaction.editReply({ content: '올바른 수량을 숫자로 입력해 주세요. (예: 100)' });
    return;
  }

  if (!robloxNick) {
    await interaction.editReply({ content: '로블록스 닉네임을 입력해 주세요.' });
    return;
  }

  if (!isGamePassLink(gamePassLink)) {
    await interaction.editReply({
      content:
        '게임패스 링크가 올바르지 않습니다. roblox.com 게임패스 URL을 붙여넣어 주세요.',
    });
    return;
  }

  try {
    const result = await buyRobux(interaction.user.id, robuxAmount);

    if (result.status === 'insufficient_gp') {
      await interaction.editReply({
        content: [
          'gppoint가 부족합니다.',
          `필요: **${result.gpCost.toLocaleString()} gp**`,
          `보유: **${result.gp.toLocaleString()} gp**`,
          '`/slot` → **GP환전**, 또는 **GP구매**로 gppoint를 모아주세요.',
        ].join('\n'),
      });
      return;
    }

    if (result.status === 'out_of_stock') {
      await interaction.editReply({
        content: `로벅스 재고가 부족합니다. 현재 재고: **${result.stock.toLocaleString()} 로벅스**`,
      });
      return;
    }

    const adminMessage = [
      '로벅스 지급 요청',
      `구매자: <@${interaction.user.id}> (${interaction.user.username})`,
      `수량: **${result.robuxAmount.toLocaleString()} 로벅스**`,
      `로블록스 닉: **${robloxNick}**`,
      `게임패스: ${gamePassLink}`,
      `남은 재고: ${result.stock.toLocaleString()}`,
    ].join('\n');

    try {
      const admin = await interaction.client.users.fetch(BALANCE_ADMIN_ID);
      await admin.send(adminMessage);
    } catch (error) {
      console.error('[dashboard] robux admin DM failed:', error.message);
    }

    try {
      await interaction.user.send(
        [
          `로벅스 **${result.robuxAmount.toLocaleString()}** 구매 완료!`,
          `닉: **${robloxNick}**`,
          `게임패스: ${gamePassLink}`,
          `차감 gppoint: **${result.gpCost.toLocaleString()} gp** / 남은 gppoint: **${result.gp.toLocaleString()} gp**`,
          '지급까지 잠시만 기다려 주세요. (관리자가 확인 후 지급)',
        ].join('\n')
      );
    } catch {
      /* DM 실패 무시 */
    }

    const logChannelId = process.env.ROBUX_LOG_CHANNEL_ID?.trim();
    if (logChannelId) {
      try {
        const channel = await interaction.client.channels.fetch(logChannelId);
        if (channel?.isTextBased()) {
          await channel.send(adminMessage);
        }
      } catch (error) {
        console.error('[dashboard] robux log post failed:', error.message);
      }
    }

    await interaction.editReply({
      content: [
        `로벅스 **${result.robuxAmount.toLocaleString()}** 구매 완료!`,
        `닉: **${robloxNick}**`,
        `남은 gppoint: **${result.gp.toLocaleString()} gp**`,
        `남은 재고: **${result.stock.toLocaleString()} 로벅스**`,
        '관리자에게 지급 요청을 보냈습니다.',
      ].join('\n'),
    });
  } catch (error) {
    console.error('[dashboard] robux buy error:', error);
    await interaction.editReply({ content: '로벅스 구매 처리 중 오류가 발생했습니다.' });
  }
}

/** gppoint를 원(잔액)으로 사는 수량 입력 모달. */
async function showGpBuyModal(interaction) {
  await showModal(interaction, {
    custom_id: GP_MODAL_ID,
    title: `gppoint 구매 (1gp = ${WON_PER_GP}원)`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: GP_AMOUNT_INPUT_ID,
            label: '구매할 gppoint 수량',
            style: 1,
            min_length: 1,
            max_length: 9,
            placeholder: '예: 100',
            required: true,
          },
        ],
      },
    ],
  });
}

/** gppoint 구매 모달 제출 → 잔액 차감 후 gp 지급. */
async function handleGpModalSubmit(interaction) {
  await deferEphemeral(interaction);

  const raw = interaction.fields.getTextInputValue(GP_AMOUNT_INPUT_ID);
  const gpAmount = Number(raw.replace(/[,\s]/g, ''));

  if (!Number.isSafeInteger(gpAmount) || gpAmount <= 0) {
    await interaction.editReply({ content: '올바른 수량을 숫자로 입력해 주세요. (예: 100)' });
    return;
  }

  try {
    const result = await buyGppoint(interaction.user.id, gpAmount);

    if (result.status === 'insufficient_won') {
      await interaction.editReply({
        content: [
          '잔액이 부족합니다.',
          `필요: **${result.cost.toLocaleString()}원** (${gpAmount}gp × ${WON_PER_GP}원)`,
          `현재 잔액: **${result.won.toLocaleString()}원**`,
        ].join('\n'),
      });
      return;
    }

    await interaction.editReply({
      content: [
        `gppoint **${gpAmount.toLocaleString()} gp** 구매 완료!`,
        `차감: **${result.cost.toLocaleString()}원**`,
        `남은 잔액: **${result.won.toLocaleString()}원**`,
        `현재 gppoint: **${result.gp.toLocaleString()} gp**`,
      ].join('\n'),
    });
  } catch (error) {
    console.error('[dashboard] gp buy error:', error);
    await interaction.editReply({ content: 'gppoint 구매 처리 중 오류가 발생했습니다.' });
  }
}

/** slotgppoint → gppoint 환전 모달. */
async function showExchangeModal(interaction) {
  await showModal(interaction, {
    custom_id: EXCHANGE_MODAL_ID,
    title: `GP환전 (${SLOT_GP_PER_GP} slotgp = 1gp)`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: EXCHANGE_AMOUNT_INPUT_ID,
            label: '받을 gppoint 수량',
            style: 1,
            min_length: 1,
            max_length: 9,
            placeholder: '예: 1 (slotgp 50 차감)',
            required: true,
          },
        ],
      },
    ],
  });
}

async function handleExchangeModalSubmit(interaction) {
  await deferEphemeral(interaction);

  const raw = interaction.fields.getTextInputValue(EXCHANGE_AMOUNT_INPUT_ID);
  const gpAmount = Number(raw.replace(/[,\s]/g, ''));

  if (!Number.isSafeInteger(gpAmount) || gpAmount <= 0) {
    await interaction.editReply({ content: '올바른 수량을 숫자로 입력해 주세요. (예: 1)' });
    return;
  }

  try {
    const result = await exchangeSlotGppoint(interaction.user.id, gpAmount);

    if (result.status === 'insufficient_slot') {
      await interaction.editReply({
        content: [
          'slotgppoint가 부족합니다.',
          `필요: **${result.slotCost.toLocaleString()} slotgp** (${gpAmount}gp × ${SLOT_GP_PER_GP})`,
          `보유: **${result.slot.toLocaleString()} slotgp**`,
          '`/slot`으로 slotgppoint를 모아주세요.',
        ].join('\n'),
      });
      return;
    }

    await interaction.editReply({
      content: [
        `환전 완료: **${result.gpAmount.toLocaleString()} gppoint**`,
        `차감: **${result.slotCost.toLocaleString()} slotgp**`,
        `남은 slotgppoint: **${result.slot.toLocaleString()} slotgp**`,
        `현재 gppoint: **${result.gp.toLocaleString()} gp**`,
      ].join('\n'),
    });
  } catch (error) {
    console.error('[dashboard] gp exchange error:', error);
    await interaction.editReply({ content: '환전 처리 중 오류가 발생했습니다.' });
  }
}

/**
 * 미매칭 입금의 [확인(충전)] 버튼 → 충전할 유저를 입력받는 모달을 띄웁니다.
 * customId: dash|mfix|<amount>
 */
async function handleMismatchFixButton(interaction) {
  const amount = interaction.customId.split('|')[2];
  const isAdministrator = interaction.memberPermissions?.has(
    PermissionFlagsBits.Administrator
  );

  if (!isAdministrator) {
    await deferEphemeral(interaction);
    await interaction.editReply({ content: '관리자만 처리할 수 있습니다.' });
    return;
  }

  await showModal(interaction, {
    custom_id: `${MFIX_MODAL_PREFIX}${amount}`,
    title: `수동 충전 (${Number(amount).toLocaleString()}원)`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: MFIX_USER_INPUT_ID,
            label: '충전할 유저 ID 또는 멘션',
            style: 1,
            min_length: 2,
            max_length: 40,
            placeholder: '예: 840401706826465300 또는 @유저',
            required: true,
          },
        ],
      },
    ],
  });
}

/**
 * 미매칭 수동 충전 모달 제출 → 입력한 유저에게 금액 충전.
 * customId: dash|mfix-modal|<amount>
 */
async function handleMismatchFixModalSubmit(interaction) {
  await deferEphemeral(interaction);

  const isAdministrator = interaction.memberPermissions?.has(
    PermissionFlagsBits.Administrator
  );
  if (!isAdministrator) {
    await interaction.editReply({ content: '관리자만 처리할 수 있습니다.' });
    return;
  }

  const amount = Number(interaction.customId.split('|')[2]);
  const rawUser = interaction.fields.getTextInputValue(MFIX_USER_INPUT_ID);
  const userId = (rawUser.match(/\d{5,}/) || [])[0];

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    await interaction.editReply({ content: '금액 정보가 올바르지 않습니다.' });
    return;
  }
  if (!userId) {
    await interaction.editReply({
      content: '유저 ID를 인식하지 못했습니다. 숫자 ID 또는 멘션을 입력해 주세요.',
    });
    return;
  }

  try {
    await updateBalance(userId, 'add', amount, { rechargeType: '수동충전' });
    const { amount: balance } = await getBalance(userId);

    try {
      const user = await interaction.client.users.fetch(userId);
      await user.send(
        [
          '입금이 관리자 확인으로 충전되었습니다.',
          `충전 금액: **${amount.toLocaleString()}원**`,
          `현재 잔액: **${balance.toLocaleString()}원**`,
        ].join('\n')
      );
    } catch {
      /* DM 실패 무시 */
    }

    await interaction.editReply({
      content: `수동 충전 완료: <@${userId}> +${amount.toLocaleString()}원 (잔액 ${balance.toLocaleString()}원)`,
    });
  } catch (error) {
    console.error('[dashboard] mismatch fix error:', error);
    await interaction.editReply({ content: '충전 처리 중 오류가 발생했습니다.' });
  }
}

/**
 * 미매칭 입금 [거부] 버튼 → 처리 완료로 표시하고 버튼 제거.
 * customId: dash|mreject|<amount>
 */
async function handleMismatchReject(interaction) {
  const isAdministrator = interaction.memberPermissions?.has(
    PermissionFlagsBits.Administrator
  );

  await deferEphemeral(interaction);

  if (!isAdministrator) {
    await interaction.editReply({ content: '관리자만 처리할 수 있습니다.' });
    return;
  }

  await interaction.editReply({ content: '거부 처리했습니다.' });
  await interaction.message
    ?.edit({ components: [] })
    .catch(() => {});
}

async function handleInfo(interaction) {
  await deferEphemeral(interaction);

  try {
    const userId = interaction.user.id;
    const [{ amount }, { amount: gp }, { rank, charged }, verified] = await Promise.all([
      getBalance(userId),
      getGppoint(userId),
      getUserRank(userId),
      getVerifiedSet(),
    ]);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('내 정보')
      .setDescription(
        [
          `• 닉네임: **${interaction.user.username}**`,
          `• 보유금액: **${amount.toLocaleString()}원**`,
          `• 누적금액: **${charged.toLocaleString()}원**`,
          `• 포인트 잔액: **${gp.toLocaleString()}원**`,
          `• 적용된 등급: **${rank.name}**${verified.has(userId) ? ' · 인증됨' : ''}`,
        ].join('\n')
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('dash|plog')
        .setLabel('구매로그')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('dash|clog')
        .setLabel('충전로그')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('dash|ranks')
        .setLabel('등업조건')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('dash|verify')
        .setLabel('인증하기')
        .setStyle(ButtonStyle.Primary)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('dash|gpbuy')
        .setLabel('GP구매')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('dash|gpexchange')
        .setLabel('GP환전')
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.editReply({ embeds: [embed], components: [row, row2] });
  } catch (error) {
    console.error('[dashboard] info error:', error);
    await interaction.editReply({ content: '잔액 정보를 불러오지 못했습니다.' });
  }
}

async function handlePurchaseLog(interaction) {
  await deferEphemeral(interaction);
  const logs = await getPurchaseLogs(interaction.user.id);

  if (logs.length === 0) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('구매 로그')
          .setDescription('최근 구매한 내역이 없습니다.'),
      ],
    });
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(PLOG_SELECT)
    .setPlaceholder('확인할 구매로그를 선택하세요.')
    .addOptions(
      logs.slice(0, 25).map((log, index) => ({
        label: `${log.name} | ${log.qty}개 | ${log.price.toLocaleString()}원`.slice(0, 100),
        description: formatKst(log.at).slice(0, 100),
        value: String(index),
      }))
    );

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('구매 로그')
    .setDescription(`최근 구매한 ${logs.length}개의 로그입니다.`);

  await interaction.editReply({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

async function handlePurchaseLogSelect(interaction) {
  await deferEphemeral(interaction);
  const logs = await getPurchaseLogs(interaction.user.id);
  const log = logs[Number(interaction.values[0])];
  if (!log) {
    await interaction.editReply({ content: '로그를 찾을 수 없습니다.' });
    return;
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('구매 상세')
        .setDescription(
          [
            `제품: **${log.name}**`,
            `카테고리: ${log.category || '-'}`,
            `수량: **${log.qty}개**`,
            `결제: **${log.price.toLocaleString()}원**`,
            `시각: ${formatKst(log.at)}`,
          ].join('\n')
        ),
    ],
  });
}

async function handleRechargeLog(interaction) {
  await deferEphemeral(interaction);
  const logs = await getRechargeLogs(interaction.user.id);

  if (logs.length === 0) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle('충전 로그')
          .setDescription('최근 충전한 내역이 없습니다.'),
      ],
    });
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(CLOG_SELECT)
    .setPlaceholder('충전 내역을 선택하세요')
    .addOptions(
      logs.slice(0, 25).map((log, index) => ({
        label: `금액 ${log.amount.toLocaleString()}원 · ${log.type}`.slice(0, 100),
        description: formatKst(log.at).slice(0, 100),
        value: String(index),
      }))
    );

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('충전 로그')
    .setDescription(`최근 충전한 ${logs.length}개의 로그가 표시됩니다.`);

  await interaction.editReply({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

async function handleRechargeLogSelect(interaction) {
  await deferEphemeral(interaction);
  const logs = await getRechargeLogs(interaction.user.id);
  const log = logs[Number(interaction.values[0])];
  if (!log) {
    await interaction.editReply({ content: '로그를 찾을 수 없습니다.' });
    return;
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('충전 상세')
        .setDescription(
          [
            `금액: **${log.amount.toLocaleString()}원**`,
            `유형: **${log.type}**`,
            `시각: ${formatKst(log.at)}`,
          ].join('\n')
        ),
    ],
  });
}

async function handleRanks(interaction) {
  await deferEphemeral(interaction);
  const { rank, charged, ranks } = await getUserRank(interaction.user.id);
  const list = ranks
    .map((item) => {
      const current = item.name === rank.name ? ' ← 현재' : '';
      const cond =
        item.minCharged <= 0 ? '조건 없음' : `누적 ${item.minCharged.toLocaleString()}원`;
      return `• **${item.name}**: ${cond} · 혜택 ${item.benefit}${current}`;
    })
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('등업 조건')
    .setDescription(
      [
        `현재 등급: **${rank.name}**`,
        `누적 충전: **${charged.toLocaleString()}원**`,
        '',
        list,
        '',
        '조건/혜택은 GitHub `data/ranks`에서 수정합니다. 혜택은 구매 할인(%)입니다.',
      ].join('\n')
    );

  await interaction.editReply({ embeds: [embed] });
}

async function handleVerify(interaction) {
  await deferEphemeral(interaction);
  const userId = interaction.user.id;
  const [{ charged }, verified] = await Promise.all([
    getUserRank(userId),
    getVerifiedSet(),
  ]);

  if (verified.has(userId)) {
    await interaction.editReply({ content: '이미 인증되어 있습니다.' });
    return;
  }

  if (charged <= 0) {
    await interaction.editReply({
      content: '인증하려면 먼저 충전이 필요합니다.',
    });
    return;
  }

  await enqueue(async () => {
    await writeDataFiles([await buildVerifiedUpdate(userId)], `verify: ${userId}`);
  });

  const roleId = process.env.VERIFIED_ROLE_ID?.trim();
  if (roleId && interaction.member?.roles) {
    await interaction.member.roles.add(roleId).catch((error) => {
      console.error('[dashboard] verify role failed:', error.message);
    });
  }

  await interaction.editReply({ content: '인증이 완료되었습니다.' });
}

async function showIngameBuyMenu(interaction, category) {
  try {
    const { products } = await getProducts();
    const soldMap = await getSoldMap();
    const items = products.filter((product) => product.category === category);

    if (items.length === 0) {
      await interaction.editReply({
        content: '이 카테고리에 제품이 없습니다.',
        components: [],
      });
      return;
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId(INGAME_BUY_SELECT)
      .setPlaceholder('제품을 선택하세요')
      .addOptions(
        items.slice(0, 25).map((product) => {
          const sold = soldMap.get(soldKey(product)) || 0;
          const stock = product.unlimited ? '무제한' : String(product.stock);
          return {
            label: product.name.slice(0, 100),
            description:
              `제품 가격: ${product.price.toLocaleString()}원 | 남은 재고: ${stock} | 판매횟수: ${sold}`.slice(
                0,
                100
              ),
            value: product.id,
          };
        })
      );

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${category}`)
      .setDescription('구매할 제품을 선택해 주세요.');

    await interaction.editReply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(menu)],
    });
  } catch (error) {
    console.error('[dashboard] purchase menu error:', error);
    await interaction.editReply({
      content: '제품 목록을 불러오지 못했습니다.',
      components: [],
    });
  }
}

/**
 * 미매칭 입금 알림에 붙일 [확인(충전)] [거부] 버튼 행을 만듭니다.
 * @param {number} amount
 */
function buildMismatchButtons(amount) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dash|mfix|${amount}`)
      .setLabel('확인 (충전)')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`dash|mreject|${amount}`)
      .setLabel('거부')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
  );
}

module.exports = {
  handleDashboardButton,
  handleDashboardSelect,
  handleChargeModalSubmit,
  handleMismatchFixModalSubmit,
  handleRobuxModalSubmit,
  handleGpModalSubmit,
  handleExchangeModalSubmit,
  createRechargeChannel,
  buildMismatchButtons,
  CHARGE_MODAL_ID,
  MFIX_MODAL_PREFIX,
  ROBUX_MODAL_ID,
  GP_MODAL_ID,
  EXCHANGE_MODAL_ID,
};

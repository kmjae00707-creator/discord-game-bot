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
const { getProducts, getBalance, purchaseProduct } = require('../utils/shopData');
const {
  deferEphemeral,
  showModal,
} = require('../utils/interactionResponse');
const { createRequest, REQUEST_TTL_MS } = require('../utils/depositRequests');

// 입금 계좌 안내 문구 (환경 변수로 관리, 미설정 시 기본 안내)
const DEPOSIT_ACCOUNT_INFO =
  process.env.DEPOSIT_ACCOUNT_INFO?.trim() ||
  '입금 계좌 정보가 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.';

const CHARGE_MODAL_ID = 'dash|charge-modal';
const CHARGE_AMOUNT_INPUT_ID = 'amount';

async function handleDashboardButton(interaction) {
  const action = interaction.customId.split('|')[1];

  if (action === 'products') {
    await handleProducts(interaction);
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

  if (action === 'close') {
    await handleCloseRechargeChannel(interaction);
    return;
  }

  if (action === 'delete') {
    await handleDeleteRechargeChannel(interaction);
  }
}

async function handleDashboardSelect(interaction) {
  if (interaction.customId !== 'dash|buy') return;

  const productId = interaction.values[0];
  await deferEphemeral(interaction);

  try {
    const result = await purchaseProduct(interaction.user.id, productId);

    if (result.status === 'not_found') {
      await interaction.editReply({ content: '선택한 제품을 찾을 수 없습니다.' });
      return;
    }

    if (result.status === 'insufficient') {
      await interaction.editReply({
        content: `잔액이 부족합니다.\n현재 잔액: **${result.balance.toLocaleString()}원**\n필요 금액: **${result.price.toLocaleString()}원**`,
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
      content: `**${result.product.name}** 구매 완료!\n남은 잔액: **${result.balance.toLocaleString()}원**\n제품 내용을 DM으로 보냈습니다.`,
    });
  } catch (error) {
    console.error('[dashboard] purchase error:', error);
    await interaction.editReply({
      content: '구매 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    });
  }
}

async function handleProducts(interaction) {
  await deferEphemeral(interaction);

  try {
    const { products } = await getProducts();

    if (products.length === 0) {
      await interaction.editReply({ content: '등록된 제품이 없습니다.' });
      return;
    }

    const list = products
      .map(
        (product, index) =>
          `• **${index + 1}. ${product.name}** — ${product.price.toLocaleString()}원`
      )
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('제품 목록')
      .setDescription(list)
      .setFooter({ text: '구매 버튼에서 원하는 제품을 선택해 주세요.' });

    await interaction.editReply({
      embeds: [embed],
    });
  } catch (error) {
    console.error('[dashboard] products error:', error);
    await interaction.editReply({ content: '제품 목록을 불러오지 못했습니다.' });
  }
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
    title: '충전 금액 입력',
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
    ],
  });
}

/**
 * 충전 금액 모달 제출 처리 → 고유 입금 금액 배정 후 안내.
 */
async function handleChargeModalSubmit(interaction) {
  await deferEphemeral(interaction);

  const raw = interaction.fields.getTextInputValue(CHARGE_AMOUNT_INPUT_ID);
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
    requestedAmount
  );

  if (result.status === 'invalid') {
    await interaction.editReply({
      content: '올바른 금액을 입력해 주세요.',
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

  const { depositAmount } = result.request;
  const minutes = Math.round(REQUEST_TTL_MS / 60000);

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('입금 대기중')
    .setDescription(
      [
        '아래 **정확한 금액**을 입금해 주세요. 금액이 다르면 자동 인식되지 않습니다.',
        '',
        `**입금 금액: ${depositAmount.toLocaleString()}원**`,
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

async function handleInfo(interaction) {
  await deferEphemeral(interaction);

  try {
    const { amount } = await getBalance(interaction.user.id);
    await interaction.editReply({
      content: `<@${interaction.user.id}>님의 현재 잔액: **${amount.toLocaleString()}원**`,
    });
  } catch (error) {
    console.error('[dashboard] info error:', error);
    await interaction.editReply({ content: '잔액 정보를 불러오지 못했습니다.' });
  }
}

async function handlePurchaseMenu(interaction) {
  await deferEphemeral(interaction);

  try {
    const { products } = await getProducts();

    if (products.length === 0) {
      await interaction.editReply({
        content: '등록된 제품이 없습니다.',
      });
      return;
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('dash|buy')
      .setPlaceholder('구매할 제품을 선택하세요')
      .addOptions(
        products.slice(0, 25).map((product) => ({
          label: product.name.slice(0, 100),
          description: `${product.price.toLocaleString()}원`.slice(0, 100),
          value: product.id,
        }))
      );

    const row = new ActionRowBuilder().addComponents(menu);

    await interaction.editReply({
      content: '구매할 제품을 선택해 주세요.',
      components: [row],
    });
  } catch (error) {
    console.error('[dashboard] purchase menu error:', error);
    await interaction.editReply({
      content: '제품 목록을 불러오지 못했습니다.',
    });
  }
}

module.exports = {
  handleDashboardButton,
  handleDashboardSelect,
  handleChargeModalSubmit,
  createRechargeChannel,
  CHARGE_MODAL_ID,
};

const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const { RECHARGE_CATEGORY_ID } = require('../commands/dashboard');
const { getProducts, getBalance, purchaseProduct } = require('../utils/shopData');

async function handleDashboardButton(interaction) {
  const action = interaction.customId.split('|')[1];

  if (action === 'products') {
    await handleProducts(interaction);
    return;
  }

  if (action === 'recharge') {
    await handleRecharge(interaction);
    return;
  }

  if (action === 'info') {
    await handleInfo(interaction);
    return;
  }

  if (action === 'purchase') {
    await handlePurchaseMenu(interaction);
  }
}

async function handleDashboardSelect(interaction) {
  if (interaction.customId !== 'dash|buy') return;

  const productId = interaction.values[0];
  await interaction.deferReply({ ephemeral: true });

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
  await interaction.deferReply({ ephemeral: true });

  try {
    const { products } = await getProducts();

    if (products.length === 0) {
      await interaction.editReply({ content: '등록된 제품이 없습니다.' });
      return;
    }

    const list = products
      .map(
        (product, index) =>
          `**${index + 1}. ${product.name}** — ${product.price.toLocaleString()}원`
      )
      .join('\n');

    await interaction.editReply({
      content: `**제품 목록**\n${list}`,
    });
  } catch (error) {
    console.error('[dashboard] products error:', error);
    await interaction.editReply({ content: '제품 목록을 불러오지 못했습니다.' });
  }
}

async function handleRecharge(interaction) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: '서버에서만 충전 채널을 생성할 수 있습니다.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const username = interaction.user.username.replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 20);
    const channelName = `충전-${username || interaction.user.id.slice(-6)}`;

    const channel = await interaction.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: RECHARGE_CATEGORY_ID,
      permissionOverwrites: [
        {
          id: interaction.guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          id: interaction.client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
          ],
        },
      ],
      reason: `충전 요청: ${interaction.user.tag}`,
    });

    await channel.send(
      `<@${interaction.user.id}> 충전 채널이 생성되었습니다.\n충전 요청 내용을 입력해 주세요.`
    );

    await interaction.editReply({
      content: `충전 채널이 생성되었습니다: ${channel}`,
    });
  } catch (error) {
    console.error('[dashboard] recharge error:', error);
    await interaction.editReply({
      content:
        '충전 채널 생성에 실패했습니다. 봇 권한(채널 관리)과 카테고리 설정을 확인해 주세요.',
    });
  }
}

async function handleInfo(interaction) {
  await interaction.deferReply({ ephemeral: true });

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
  await interaction.deferReply({ ephemeral: true });

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
};

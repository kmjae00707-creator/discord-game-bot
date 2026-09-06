const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { replyEphemeral } = require('../utils/interactionResponse');

const RECHARGE_CATEGORY_ID = '1533500110087131327';

const dashboardCommand = {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('자동충전/구매 대시보드를 게시합니다.')
    .setDMPermission(false),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('자동충전 / 구매')
      .setDescription(
        [
          '• 원하시는 버튼을 클릭해 주세요.',
          '• 24시간 자동충전 및 구매가 가능합니다.',
          '• 문제가 발생할 경우 문의하기에 앞서 필독사항을 확인하시고 문의하기 채널을 통해 문의해 주세요.',
        ].join('\n')
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('dash|products')
        .setLabel('제품')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('dash|recharge')
        .setLabel('충전')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('dash|info')
        .setLabel('정보')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('dash|purchase')
        .setLabel('구매')
        .setStyle(ButtonStyle.Primary)
    );

    await replyEphemeral(interaction, '대시보드를 게시했습니다.');

    await interaction.channel.send({
      embeds: [embed],
      components: [row],
    });
  },
};

module.exports = {
  dashboardCommand,
  RECHARGE_CATEGORY_ID,
};

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
          '• 제품: **로벅스** / **인게임**',
          '• 로벅스 = gppoint로 구매 (1 gp = 1 로벅스 = 6.667원)',
          '• `/slot`으로 slotgppoint를 모으고 **GP환전**(50 slotgp = 1 gp)',
          '• gppoint는 **GP구매**(원) 또는 환전으로 모읍니다.',
          '• 24시간 자동충전 및 구매가 가능합니다.',
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

    await replyEphemeral(interaction, '대시보드를 게시했습니다.');

    await interaction.channel.send({
      embeds: [embed],
      components: [row, row2],
    });
  },
};

module.exports = {
  dashboardCommand,
  RECHARGE_CATEGORY_ID,
};

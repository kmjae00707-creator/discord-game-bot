const { SlashCommandBuilder } = require('discord.js');
const { deferEphemeral } = require('../utils/interactionResponse');
const {
  getGppoint,
  updateGppoint,
  buyGppoint,
  WON_PER_GP,
} = require('../utils/gppointData');
const { BALANCE_ADMIN_ID } = require('./balance');

const gppointCommand = {
  data: new SlashCommandBuilder()
    .setName('gppoint')
    .setDescription('gppoint를 확인하거나 구매합니다.')
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub.setName('view').setDescription('내 gppoint를 확인합니다.')
    )
    .addSubcommand((sub) =>
      sub
        .setName('buy')
        .setDescription(`gppoint를 구매합니다. (1gp = ${WON_PER_GP}원)`)
        .addIntegerOption((option) =>
          option
            .setName('수량')
            .setDescription('구매할 gppoint 수량')
            .setMinValue(1)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('give')
        .setDescription('(관리자) 유저에게 gppoint를 지급합니다.')
        .addUserOption((o) =>
          o.setName('사용자').setDescription('대상 유저').setRequired(true)
        )
        .addIntegerOption((o) =>
          o
            .setName('수량')
            .setDescription('지급할 gppoint')
            .setMinValue(1)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('take')
        .setDescription('(관리자) 유저의 gppoint를 회수합니다.')
        .addUserOption((o) =>
          o.setName('사용자').setDescription('대상 유저').setRequired(true)
        )
        .addIntegerOption((o) =>
          o
            .setName('수량')
            .setDescription('회수할 gppoint')
            .setMinValue(1)
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    await deferEphemeral(interaction);
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'view') {
        const { amount } = await getGppoint(interaction.user.id);
        await interaction.editReply({
          content: `${interaction.user}님의 gppoint: **${amount.toLocaleString()} gp**`,
        });
        return;
      }

      if (sub === 'buy') {
        const gpAmount = interaction.options.getInteger('수량', true);
        const result = await buyGppoint(interaction.user.id, gpAmount);

        if (result.status === 'insufficient_won') {
          await interaction.editReply({
            content: [
              'gppoint 구매에 필요한 잔액이 부족합니다.',
              `필요 금액: **${result.cost.toLocaleString()}원** (${gpAmount}gp × ${WON_PER_GP}원)`,
              `현재 잔액: **${result.won.toLocaleString()}원**`,
            ].join('\n'),
          });
          return;
        }

        await interaction.editReply({
          content: [
            `gppoint **${gpAmount.toLocaleString()}gp** 구매 완료!`,
            `차감 금액: **${result.cost.toLocaleString()}원**`,
            `남은 잔액: **${result.won.toLocaleString()}원**`,
            `현재 gppoint: **${result.gp.toLocaleString()} gp**`,
          ].join('\n'),
        });
        return;
      }

      // give / take: 관리자 전용
      if (interaction.user.id !== BALANCE_ADMIN_ID) {
        await interaction.editReply({
          content: '이 명령어를 사용할 권한이 없습니다.',
        });
        return;
      }

      const target = interaction.options.getUser('사용자', true);
      const amount = interaction.options.getInteger('수량', true);
      const operation = sub === 'give' ? 'add' : 'remove';
      const result = await updateGppoint(target.id, operation, amount);

      await interaction.editReply({
        content: [
          `${target}님의 gppoint를 **${sub === 'give' ? '지급' : '회수'}**했습니다.`,
          `변경 전: **${result.previous.toLocaleString()} gp**`,
          `변경 후: **${result.amount.toLocaleString()} gp**`,
        ].join('\n'),
      });
    } catch (error) {
      console.error('[gppoint] command error:', error);
      await interaction.editReply({
        content: 'gppoint 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
  },
};

module.exports = { gppointCommand };

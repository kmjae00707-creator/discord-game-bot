const { SlashCommandBuilder } = require('discord.js');
const { deferEphemeral } = require('../utils/interactionResponse');
const { getBalance, updateBalance } = require('../utils/shopData');

const BALANCE_ADMIN_ID = '840401706826465300';

function addUserOption(subcommand) {
  return subcommand.addUserOption((option) =>
    option
      .setName('사용자')
      .setDescription('잔액을 관리할 사용자')
      .setRequired(true)
  );
}

function addAmountOption(subcommand, minimum = 1) {
  return subcommand.addIntegerOption((option) =>
    option
      .setName('금액')
      .setDescription('적용할 금액')
      .setMinValue(minimum)
      .setRequired(true)
  );
}

const balanceCommand = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('사용자 잔액을 관리합니다.')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      addAmountOption(
        addUserOption(
          subcommand.setName('add').setDescription('잔액을 추가합니다.')
        )
      )
    )
    .addSubcommand((subcommand) =>
      addAmountOption(
        addUserOption(
          subcommand.setName('remove').setDescription('잔액을 차감합니다.')
        )
      )
    )
    .addSubcommand((subcommand) =>
      addAmountOption(
        addUserOption(
          subcommand.setName('set').setDescription('잔액을 설정합니다.')
        ),
        0
      )
    )
    .addSubcommand((subcommand) =>
      addUserOption(
        subcommand.setName('view').setDescription('잔액을 조회합니다.')
      )
    )
    .addSubcommand((subcommand) =>
      addUserOption(
        subcommand
          .setName('clear')
          .setDescription('사용자의 잔액 기록을 삭제합니다.')
      )
    ),

  async execute(interaction) {
    await deferEphemeral(interaction);

    if (interaction.user.id !== BALANCE_ADMIN_ID) {
      await interaction.editReply({
        content: '이 명령어를 사용할 권한이 없습니다.',
      });
      return;
    }

    const operation = interaction.options.getSubcommand();
    const user = interaction.options.getUser('사용자', true);

    try {
      if (operation === 'view') {
        const { amount } = await getBalance(user.id);
        await interaction.editReply({
          content: `${user}님의 현재 잔액: **${amount.toLocaleString()}원**`,
        });
        return;
      }

      const amount =
        operation === 'clear'
          ? 0
          : interaction.options.getInteger('금액', true);
      const result = await updateBalance(user.id, operation, amount);

      const operationLabels = {
        add: '추가',
        remove: '차감',
        set: '설정',
        clear: '기록 삭제',
      };

      await interaction.editReply({
        content: [
          `${user}님의 잔액을 **${operationLabels[operation]}**했습니다.`,
          `변경 전: **${result.previousBalance.toLocaleString()}원**`,
          `변경 후: **${result.balance.toLocaleString()}원**`,
        ].join('\n'),
      });
    } catch (error) {
      console.error('[balance] command error:', error);
      await interaction.editReply({
        content: '잔액 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
  },
};

module.exports = {
  balanceCommand,
  BALANCE_ADMIN_ID,
};

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const ttt = require('../utils/tictactoe');

function buildBoardComponents(game) {
  const rows = [];

  for (let row = 0; row < 3; row += 1) {
    const actionRow = new ActionRowBuilder();
    for (let col = 0; col < 3; col += 1) {
      const index = row * 3 + col;
      const label = ttt.getEmojiForCell(game.board, index);
      const isEmpty = game.board[index] === 0;

      const button = new ButtonBuilder()
        .setCustomId(`ttt|${game.id}|${index}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!isEmpty || game.finished);

      actionRow.addComponents(button);
    }
    rows.push(actionRow);
  }

  return rows;
}

function buildStatusText(game, challenger, opponent) {
  if (game.finished) {
    if (game.winner === 0) {
      return `🤝 **무승부!**\n${challenger} 🫄 vs ${opponent} 🫃`;
    }

    const winnerId = ttt.getWinnerUserId(game);
    const winnerMention = winnerId === game.challengerId ? challenger : opponent;
    const winnerEmoji = winnerId === game.challengerId ? '🫄' : '🫃';
    return `🏆 **${winnerMention}** (${winnerEmoji}) 승리!\n3개를 먼저 완성했습니다!`;
  }

  const currentId = ttt.getExpectedPlayerId(game);
  const currentMention = currentId === game.challengerId ? challenger : opponent;
  const currentEmoji = currentId === game.challengerId ? '🫄' : '🫃';

  return `🎮 **틱택토**\n${challenger} 🫄 vs ${opponent} 🫃\n\n${currentMention} (${currentEmoji}) 차례입니다.`;
}

const tictaktoCommand = {
  data: new SlashCommandBuilder()
    .setName('tictakto')
    .setDescription('상대와 틱택토 게임을 시작합니다.')
    .addUserOption((option) =>
      option
        .setName('상대')
        .setDescription('함께 플레이할 상대')
        .setRequired(true)
    ),

  async execute(interaction) {
    const opponent = interaction.options.getUser('상대', true);
    const challenger = interaction.user;

    if (opponent.bot) {
      await interaction.reply({
        content: '봇과는 플레이할 수 없습니다.',
        ephemeral: true,
      });
      return;
    }

    if (opponent.id === challenger.id) {
      await interaction.reply({
        content: '자기 자신과는 플레이할 수 없습니다.',
        ephemeral: true,
      });
      return;
    }

    const game = ttt.createGame(challenger.id, opponent.id);
    const challengerMention = `<@${challenger.id}>`;
    const opponentMention = `<@${opponent.id}>`;

    await interaction.reply({
      content: buildStatusText(game, challengerMention, opponentMention),
      components: buildBoardComponents(game),
    });

    const message = await interaction.fetchReply();
    game.messageId = message.id;
    game.channelId = message.channelId;
  },
};

async function handleTttButton(interaction) {
  const [, gameId, cellIndexStr] = interaction.customId.split('|');
  const cellIndex = Number(cellIndexStr);

  const game = ttt.getGame(gameId);
  if (!game) {
    await interaction.reply({
      content: '게임을 찾을 수 없습니다. 새 게임을 시작해 주세요.',
      ephemeral: true,
    });
    return;
  }

  if (!ttt.isParticipant(game, interaction.user.id)) {
    await interaction.reply({
      content: '이 게임 참가자만 버튼을 누를 수 있습니다.',
      ephemeral: true,
    });
    return;
  }

  if (game.finished) {
    await interaction.reply({
      content: '이미 종료된 게임입니다.',
      ephemeral: true,
    });
    return;
  }

  if (interaction.user.id !== ttt.getExpectedPlayerId(game)) {
    await interaction.reply({
      content: '지금은 상대 차례입니다.',
      ephemeral: true,
    });
    return;
  }

  const player = ttt.getPlayerByUserId(game, interaction.user.id);
  const result = ttt.applyMove(game, cellIndex, player);

  if (!result.ok) {
    await interaction.reply({
      content: '이미 선택된 칸입니다.',
      ephemeral: true,
    });
    return;
  }

  const challengerMention = `<@${game.challengerId}>`;
  const opponentMention = `<@${game.opponentId}>`;

  await interaction.update({
    content: buildStatusText(game, challengerMention, opponentMention),
    components: buildBoardComponents(game),
  });

  if (game.finished) {
    setTimeout(() => ttt.deleteGame(game.id), 60 * 60 * 1000);
  }
}

module.exports = {
  tictaktoCommand,
  handleTttButton,
};

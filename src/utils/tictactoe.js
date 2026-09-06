const PLAYER = {
  CHALLENGER: 1,
  OPPONENT: 2,
};

const EMOJI = {
  [PLAYER.CHALLENGER]: '🫄',
  [PLAYER.OPPONENT]: '🫃',
};

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/** @type {Map<string, import('./tictactoeTypes').GameState>} */
const games = new Map();

function createGameId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createGame(challengerId, opponentId) {
  const id = createGameId();
  const game = {
    id,
    challengerId,
    opponentId,
    board: Array(9).fill(0),
    currentPlayer: PLAYER.CHALLENGER,
    finished: false,
    winner: null,
    messageId: null,
    channelId: null,
  };
  games.set(id, game);
  return game;
}

function getGame(gameId) {
  return games.get(gameId) || null;
}

function deleteGame(gameId) {
  games.delete(gameId);
}

function isParticipant(game, userId) {
  return userId === game.challengerId || userId === game.opponentId;
}

function getExpectedPlayerId(game) {
  return game.currentPlayer === PLAYER.CHALLENGER
    ? game.challengerId
    : game.opponentId;
}

function getPlayerByUserId(game, userId) {
  if (userId === game.challengerId) return PLAYER.CHALLENGER;
  if (userId === game.opponentId) return PLAYER.OPPONENT;
  return null;
}

function applyMove(game, cellIndex, player) {
  if (game.finished || game.board[cellIndex] !== 0) {
    return { ok: false, reason: 'occupied' };
  }

  game.board[cellIndex] = player;

  const winner = findWinner(game.board);
  if (winner) {
    game.finished = true;
    game.winner = winner;
    return { ok: true, winner };
  }

  if (game.board.every((cell) => cell !== 0)) {
    game.finished = true;
    game.winner = 0;
    return { ok: true, winner: 0 };
  }

  game.currentPlayer =
    game.currentPlayer === PLAYER.CHALLENGER
      ? PLAYER.OPPONENT
      : PLAYER.CHALLENGER;

  return { ok: true, winner: null };
}

function findWinner(board) {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] !== 0 && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return null;
}

function getWinnerUserId(game) {
  if (!game.winner) return null;
  return game.winner === PLAYER.CHALLENGER
    ? game.challengerId
    : game.opponentId;
}

function getEmojiForCell(board, index) {
  const value = board[index];
  if (!value) return '\u200b';
  return EMOJI[value];
}

function getPlayerLabel(player) {
  return player === PLAYER.CHALLENGER ? '플레이어 1 (🫄)' : '플레이어 2 (🫃)';
}

module.exports = {
  PLAYER,
  EMOJI,
  games,
  createGame,
  getGame,
  deleteGame,
  isParticipant,
  getExpectedPlayerId,
  getPlayerByUserId,
  applyMove,
  getWinnerUserId,
  getEmojiForCell,
  getPlayerLabel,
};

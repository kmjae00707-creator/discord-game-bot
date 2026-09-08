'use strict';

const { readDataFile, writeDataFiles } = require('./dataStore');
const { enqueue } = require('./mutationQueue');
const {
  parseBalances,
  balancesToContent,
  BALANCE_FILE,
} = require('./shopData');

const GPPOINT_FILE = 'gppoint';
const ROBUX_FILE = 'robux';

// 환율
const WON_PER_GP = Number(process.env.WON_PER_GP) || 15; // 1 gppoint = 15원
const ROBUX_PER_GP = Number(process.env.ROBUX_PER_GP) || 1; // 1 gppoint = 1 로벅스

/** gppoint 잔액 파일은 balance와 동일한 "userId:수량" 형식을 사용합니다. */
function parsePoints(content) {
  return parseBalances(content);
}

function pointsToContent(points) {
  return balancesToContent(points);
}

/** robux 재고 파일에서 남은 수량(정수)을 읽습니다. 첫 숫자 라인 사용. */
function parseRobuxStock(content) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const value = Number(trimmed.replace(/[,\s]/g, ''));
    if (Number.isSafeInteger(value) && value >= 0) return value;
  }
  return 0;
}

function robuxStockToContent(stock) {
  return `${stock}\n`;
}

async function getGppoint(userId) {
  const file = await readDataFile(GPPOINT_FILE);
  const points = parsePoints(file.content);
  return { amount: points.get(userId) || 0, points };
}

async function getRobuxStock() {
  const file = await readDataFile(ROBUX_FILE);
  return { stock: parseRobuxStock(file.content) };
}

/* ------------------------- 변경 작업(원자적) ------------------------- */

async function executeGppointUpdate(userId, operation, amount = 0) {
  const file = await readDataFile(GPPOINT_FILE);
  const points = parsePoints(file.content);
  const previous = points.get(userId) || 0;
  let next;

  switch (operation) {
    case 'add':
      next = previous + amount;
      points.set(userId, next);
      break;
    case 'remove':
      next = Math.max(0, previous - amount);
      points.set(userId, next);
      break;
    case 'set':
      next = amount;
      points.set(userId, next);
      break;
    case 'clear':
      next = 0;
      points.delete(userId);
      break;
    default:
      throw new Error(`Unsupported gppoint operation: ${operation}`);
  }

  await writeDataFiles(
    [{ filename: GPPOINT_FILE, content: pointsToContent(points) }],
    `gppoint: ${operation} ${userId} (${previous} -> ${next})`
  );

  return { previous, amount: next };
}

/** gppoint를 원(잔액)으로 구매: 1gp = WON_PER_GP원. */
async function executeBuyGppoint(userId, gpAmount) {
  const cost = gpAmount * WON_PER_GP;

  const balanceFile = await readDataFile(BALANCE_FILE);
  const balances = parseBalances(balanceFile.content);
  const won = balances.get(userId) || 0;

  if (won < cost) {
    return { status: 'insufficient_won', won, cost };
  }

  const gpFile = await readDataFile(GPPOINT_FILE);
  const points = parsePoints(gpFile.content);
  const gp = points.get(userId) || 0;

  balances.set(userId, won - cost);
  points.set(userId, gp + gpAmount);

  await writeDataFiles(
    [
      { filename: BALANCE_FILE, content: balancesToContent(balances) },
      { filename: GPPOINT_FILE, content: pointsToContent(points) },
    ],
    `buy gppoint: ${userId} +${gpAmount}gp (-${cost}won)`
  );

  return {
    status: 'success',
    cost,
    gpAmount,
    won: won - cost,
    gp: gp + gpAmount,
  };
}

/** gppoint로 로벅스 구매: 1gp = ROBUX_PER_GP 로벅스. 재고 차감. */
async function executeBuyRobux(userId, robuxAmount) {
  const gpCost = Math.ceil(robuxAmount / ROBUX_PER_GP);

  const gpFile = await readDataFile(GPPOINT_FILE);
  const points = parsePoints(gpFile.content);
  const gp = points.get(userId) || 0;

  if (gp < gpCost) {
    return { status: 'insufficient_gp', gp, gpCost };
  }

  const robuxFile = await readDataFile(ROBUX_FILE);
  const stock = parseRobuxStock(robuxFile.content);

  if (stock < robuxAmount) {
    return { status: 'out_of_stock', stock };
  }

  points.set(userId, gp - gpCost);

  await writeDataFiles(
    [
      { filename: GPPOINT_FILE, content: pointsToContent(points) },
      { filename: ROBUX_FILE, content: robuxStockToContent(stock - robuxAmount) },
    ],
    `buy robux: ${userId} -${robuxAmount}robux (-${gpCost}gp)`
  );

  return {
    status: 'success',
    robuxAmount,
    gpCost,
    gp: gp - gpCost,
    stock: stock - robuxAmount,
  };
}

/* ------------------------- 공개 API(큐 경유) ------------------------- */

function updateGppoint(userId, operation, amount) {
  if (!['add', 'remove', 'set', 'clear'].includes(operation)) {
    throw new Error('유효하지 않은 gppoint 작업입니다.');
  }
  if (operation !== 'clear' && (!Number.isSafeInteger(amount) || amount < 0)) {
    throw new Error('수량은 0 이상의 안전한 정수여야 합니다.');
  }
  return enqueue(() => executeGppointUpdate(userId, operation, amount));
}

function buyGppoint(userId, gpAmount) {
  if (!Number.isSafeInteger(gpAmount) || gpAmount <= 0) {
    throw new Error('구매 수량은 1 이상의 정수여야 합니다.');
  }
  return enqueue(() => executeBuyGppoint(userId, gpAmount));
}

function buyRobux(userId, robuxAmount) {
  if (!Number.isSafeInteger(robuxAmount) || robuxAmount <= 0) {
    throw new Error('구매 수량은 1 이상의 정수여야 합니다.');
  }
  return enqueue(() => executeBuyRobux(userId, robuxAmount));
}

module.exports = {
  getGppoint,
  getRobuxStock,
  updateGppoint,
  buyGppoint,
  buyRobux,
  WON_PER_GP,
  ROBUX_PER_GP,
};

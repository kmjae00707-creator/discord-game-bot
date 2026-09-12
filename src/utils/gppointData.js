'use strict';

const { readDataFile, writeDataFiles } = require('./dataStore');
const { enqueue } = require('./mutationQueue');
const {
  parseBalances,
  balancesToContent,
  BALANCE_FILE,
} = require('./shopData');
const { buildPurchaseLogUpdate, buildSoldUpdate } = require('./userLedger');

const GPPOINT_FILE = 'gppoint';
const SLOT_GP_FILE = 'slotgppoint';
const ROBUX_FILE = 'robux';

// 환율
const WON_PER_GP = Number(process.env.WON_PER_GP) || 6.667; // 1 gppoint = 6.667원
const ROBUX_PER_GP = Number(process.env.ROBUX_PER_GP) || 1; // 1 gppoint = 1 로벅스
const SLOT_GP_PER_GP = Number(process.env.SLOT_GP_PER_GP) || 50; // 50 slotgppoint = 1 gppoint

/** 원 잔액은 정수이므로 gp×환율을 반올림합니다. */
function gpToWon(gpAmount) {
  return Math.max(1, Math.round(gpAmount * WON_PER_GP));
}

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

async function getSlotGppoint(userId) {
  const file = await readDataFile(SLOT_GP_FILE);
  const points = parsePoints(file.content);
  return { amount: points.get(userId) || 0, points };
}

async function getRobuxStock() {
  const file = await readDataFile(ROBUX_FILE);
  return { stock: parseRobuxStock(file.content) };
}

/* ------------------------- 변경 작업(원자적) ------------------------- */

async function executePointUpdate(filename, userId, operation, amount = 0) {
  const file = await readDataFile(filename);
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
      throw new Error(`Unsupported point operation: ${operation}`);
  }

  await writeDataFiles(
    [{ filename, content: pointsToContent(points) }],
    `${filename}: ${operation} ${userId} (${previous} -> ${next})`
  );

  return { previous, amount: next };
}

async function executeGppointUpdate(userId, operation, amount = 0) {
  return executePointUpdate(GPPOINT_FILE, userId, operation, amount);
}

async function executeSlotGppointUpdate(userId, operation, amount = 0) {
  return executePointUpdate(SLOT_GP_FILE, userId, operation, amount);
}

/** gppoint를 원(잔액)으로 구매: 1gp = WON_PER_GP원. */
async function executeBuyGppoint(userId, gpAmount) {
  const cost = gpToWon(gpAmount);

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

  const robuxProduct = {
    category: '로벅스',
    name: `로벅스 ${robuxAmount}`,
  };

  await writeDataFiles(
    [
      { filename: GPPOINT_FILE, content: pointsToContent(points) },
      { filename: ROBUX_FILE, content: robuxStockToContent(stock - robuxAmount) },
      await buildSoldUpdate(robuxProduct),
      await buildPurchaseLogUpdate(userId, robuxProduct, robuxAmount, gpCost),
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

/** slotgppoint → gppoint 환전: SLOT_GP_PER_GP slotgp = 1 gp. */
async function executeExchangeSlotGppoint(userId, gpAmount) {
  const slotCost = gpAmount * SLOT_GP_PER_GP;

  const slotFile = await readDataFile(SLOT_GP_FILE);
  const slotPoints = parsePoints(slotFile.content);
  const slot = slotPoints.get(userId) || 0;

  if (slot < slotCost) {
    return { status: 'insufficient_slot', slot, slotCost, gpAmount };
  }

  const gpFile = await readDataFile(GPPOINT_FILE);
  const gpPoints = parsePoints(gpFile.content);
  const gp = gpPoints.get(userId) || 0;

  slotPoints.set(userId, slot - slotCost);
  gpPoints.set(userId, gp + gpAmount);

  await writeDataFiles(
    [
      { filename: SLOT_GP_FILE, content: pointsToContent(slotPoints) },
      { filename: GPPOINT_FILE, content: pointsToContent(gpPoints) },
    ],
    `exchange slotgp: ${userId} -${slotCost}slotgp +${gpAmount}gp`
  );

  return {
    status: 'success',
    gpAmount,
    slotCost,
    slot: slot - slotCost,
    gp: gp + gpAmount,
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

function updateSlotGppoint(userId, operation, amount) {
  if (!['add', 'remove', 'set', 'clear'].includes(operation)) {
    throw new Error('유효하지 않은 slotgppoint 작업입니다.');
  }
  if (operation !== 'clear' && (!Number.isSafeInteger(amount) || amount < 0)) {
    throw new Error('수량은 0 이상의 안전한 정수여야 합니다.');
  }
  return enqueue(() => executeSlotGppointUpdate(userId, operation, amount));
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

function exchangeSlotGppoint(userId, gpAmount) {
  if (!Number.isSafeInteger(gpAmount) || gpAmount <= 0) {
    throw new Error('환전 수량은 1 이상의 정수여야 합니다.');
  }
  return enqueue(() => executeExchangeSlotGppoint(userId, gpAmount));
}

module.exports = {
  getGppoint,
  getSlotGppoint,
  getRobuxStock,
  updateGppoint,
  updateSlotGppoint,
  buyGppoint,
  buyRobux,
  exchangeSlotGppoint,
  WON_PER_GP,
  ROBUX_PER_GP,
  SLOT_GP_PER_GP,
  gpToWon,
};

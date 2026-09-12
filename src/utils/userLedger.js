'use strict';

const { readDataFile } = require('./dataStore');

const CHARGED_FILE = 'charged';
const SOLD_FILE = 'sold';
const PURCHASE_LOG_FILE = 'purchaselog';
const RECHARGE_LOG_FILE = 'rechargelog';
const RANKS_FILE = 'ranks';
const NOTICE_FILE = 'notice';
const VERIFIED_FILE = 'verified';
const BANNER_FILE = 'banner';
const FOOTER_FILE = 'footer';

const LOG_LIMIT = 25;

function parseMap(content) {
  const map = new Map();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf(':');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const amount = Number(trimmed.slice(separator + 1).trim());
    if (!key || Number.isNaN(amount)) continue;
    map.set(key, amount);
  }
  return map;
}

function mapToContent(map, header) {
  const body = Array.from(map.entries())
    .map(([key, amount]) => `${key}:${amount}`)
    .join('\n');
  return `${header}${body ? `${body}\n` : ''}`;
}

function parseLogLines(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function appendLogContent(content, line, header) {
  const existing = parseLogLines(content);
  existing.push(line);
  return `${header}${existing.join('\n')}\n`;
}

function formatKst(timestamp) {
  return new Date(timestamp).toLocaleString('sv-SE', {
    timeZone: 'Asia/Seoul',
  });
}

function soldKey(product) {
  return `${product.category}|${product.name}`;
}

async function getNotice() {
  const file = await readDataFile(NOTICE_FILE);
  const text = file.content.replace(/^\uFEFF/, '').trim();
  return text || '등록된 공지가 없습니다. GitHub `data/notice`에 작성해 주세요.';
}

async function getBannerUrl() {
  const envUrl = process.env.DASHBOARD_BANNER_URL?.trim();
  if (envUrl) return envUrl;
  const file = await readDataFile(BANNER_FILE);
  const line = file.content
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith('#') && /^https?:\/\//i.test(item));
  return line || null;
}

async function getFooterText() {
  const envFooter = process.env.DASHBOARD_FOOTER?.trim();
  if (envFooter) return envFooter;
  const file = await readDataFile(FOOTER_FILE);
  const text = file.content.replace(/^\uFEFF/, '').trim();
  return text || '문제가 생기면 문의하기 채널로 알려 주세요.';
}

async function getCharged(userId) {
  const file = await readDataFile(CHARGED_FILE);
  const map = parseMap(file.content);
  return map.get(userId) || 0;
}

async function getSoldMap() {
  const file = await readDataFile(SOLD_FILE);
  return parseMap(file.content);
}

async function getVerifiedSet() {
  const file = await readDataFile(VERIFIED_FILE);
  return new Set(
    file.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
  );
}

function parseRanks(content) {
  const ranks = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const parts = line.split('|');
      if (parts.length < 3) return null;
      const name = parts[0].trim();
      const minCharged = Number(parts[1].trim());
      const discount = Number(parts[2].trim());
      const benefit = (parts[3] || '').trim() || (discount > 0 ? `${discount}% 할인` : '혜택 없음');
      if (!name || Number.isNaN(minCharged) || Number.isNaN(discount)) return null;
      return { name, minCharged, discount, benefit };
    })
    .filter(Boolean)
    .sort((a, b) => a.minCharged - b.minCharged);

  if (ranks.length > 0) return ranks;
  return [
    { name: 'User', minCharged: 0, discount: 0, benefit: '기본 등급' },
    { name: 'Buyer', minCharged: 1, discount: 0, benefit: '첫 충전 후 구매자' },
  ];
}

async function getRanks() {
  const file = await readDataFile(RANKS_FILE);
  return parseRanks(file.content);
}

async function getUserRank(userId) {
  const [charged, ranks] = await Promise.all([getCharged(userId), getRanks()]);
  let current = ranks[0];
  for (const rank of ranks) {
    if (charged >= rank.minCharged) current = rank;
  }
  return { rank: current, charged, ranks };
}

function discountedPrice(price, discountPercent) {
  if (!discountPercent) return price;
  return Math.max(0, Math.round((price * (100 - discountPercent)) / 100));
}

async function getUserLogs(userId, filename) {
  const file = await readDataFile(filename);
  return parseLogLines(file.content)
    .map((line) => line.split('|'))
    .filter((parts) => parts[1] === userId)
    .slice(-LOG_LIMIT)
    .reverse();
}

async function getPurchaseLogs(userId) {
  const rows = await getUserLogs(userId, PURCHASE_LOG_FILE);
  return rows.map((parts) => ({
    at: Number(parts[0]),
    name: parts[2] || '제품',
    qty: Number(parts[3]) || 1,
    price: Number(parts[4]) || 0,
    category: parts[5] || '',
  }));
}

async function getRechargeLogs(userId) {
  const rows = await getUserLogs(userId, RECHARGE_LOG_FILE);
  return rows.map((parts) => ({
    at: Number(parts[0]),
    amount: Number(parts[2]) || 0,
    type: parts[3] || '충전',
  }));
}

async function buildChargedUpdate(userId, addAmount) {
  const file = await readDataFile(CHARGED_FILE);
  const map = parseMap(file.content);
  map.set(userId, (map.get(userId) || 0) + addAmount);
  return {
    filename: CHARGED_FILE,
    content: mapToContent(map, '# 누적 충전액 (유저ID:금액)\n'),
  };
}

async function buildSoldUpdate(product) {
  const file = await readDataFile(SOLD_FILE);
  const map = parseMap(file.content);
  const key = soldKey(product);
  map.set(key, (map.get(key) || 0) + 1);
  return {
    filename: SOLD_FILE,
    content: mapToContent(map, '# 제품 판매횟수 (카테고리|이름:횟수)\n'),
  };
}

async function buildPurchaseLogUpdate(userId, product, qty, price) {
  const file = await readDataFile(PURCHASE_LOG_FILE);
  const line = `${Date.now()}|${userId}|${product.name}|${qty}|${price}|${product.category}`;
  return {
    filename: PURCHASE_LOG_FILE,
    content: appendLogContent(file.content, line, '# 구매로그 time|userId|이름|수량|가격|카테고리\n'),
  };
}

async function buildRechargeLogUpdate(userId, amount, type) {
  const file = await readDataFile(RECHARGE_LOG_FILE);
  const line = `${Date.now()}|${userId}|${amount}|${type}`;
  return {
    filename: RECHARGE_LOG_FILE,
    content: appendLogContent(file.content, line, '# 충전로그 time|userId|금액|유형\n'),
  };
}

async function buildVerifiedUpdate(userId) {
  const file = await readDataFile(VERIFIED_FILE);
  const ids = new Set(
    file.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
  );
  ids.add(userId);
  return {
    filename: VERIFIED_FILE,
    content: `# 인증된 유저 ID\n${Array.from(ids).join('\n')}\n`,
  };
}

module.exports = {
  getNotice,
  getBannerUrl,
  getFooterText,
  getCharged,
  getSoldMap,
  getVerifiedSet,
  getRanks,
  getUserRank,
  discountedPrice,
  getPurchaseLogs,
  getRechargeLogs,
  buildChargedUpdate,
  buildSoldUpdate,
  buildPurchaseLogUpdate,
  buildRechargeLogUpdate,
  buildVerifiedUpdate,
  soldKey,
  formatKst,
  LOG_LIMIT,
};

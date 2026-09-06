const { readDataFile, writeDataFile } = require('./dataStore');

const SHOP_FILE = 'shop';
const BALANCE_FILE = 'balance';

function parseShop(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line, index) => {
      const parts = line.split('|');
      if (parts.length < 3) return null;

      const name = parts[0].trim();
      const price = Number(parts[1].trim());
      const productContent = parts.slice(2).join('|').trim();

      if (!name || Number.isNaN(price) || price < 0 || !productContent) {
        return null;
      }

      return {
        id: String(index),
        name,
        price,
        content: productContent,
      };
    })
    .filter(Boolean);
}

function parseBalances(content) {
  const balances = new Map();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf(':');
    if (separator <= 0) continue;

    const userId = trimmed.slice(0, separator).trim();
    const amount = Number(trimmed.slice(separator + 1).trim());
    if (!userId || Number.isNaN(amount)) continue;

    balances.set(userId, amount);
  }

  return balances;
}

function balancesToContent(balances) {
  if (balances.size === 0) return '';
  return `${Array.from(balances.entries())
    .map(([userId, amount]) => `${userId}:${amount}`)
    .join('\n')}\n`;
}

async function getProducts() {
  const file = await readDataFile(SHOP_FILE);
  return { products: parseShop(file.content), sha: file.sha };
}

async function getBalance(userId) {
  const file = await readDataFile(BALANCE_FILE);
  const balances = parseBalances(file.content);
  return {
    amount: balances.get(userId) || 0,
    balances,
    sha: file.sha,
  };
}

async function purchaseProduct(userId, productId) {
  const { products } = await getProducts();
  const product = products.find((item) => item.id === productId);

  if (!product) {
    return { status: 'not_found' };
  }

  const file = await readDataFile(BALANCE_FILE);
  const balances = parseBalances(file.content);
  const current = balances.get(userId) || 0;

  if (current < product.price) {
    return {
      status: 'insufficient',
      balance: current,
      price: product.price,
    };
  }

  balances.set(userId, current - product.price);

  await writeDataFile(
    BALANCE_FILE,
    balancesToContent(balances),
    file.sha,
    `purchase: ${userId} bought ${product.name}`
  );

  return {
    status: 'success',
    product,
    balance: current - product.price,
  };
}

module.exports = {
  getProducts,
  getBalance,
  purchaseProduct,
};

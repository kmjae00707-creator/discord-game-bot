const { readDataFile, writeDataFiles } = require('./dataStore');

const SHOP_FILE = 'shop';
const BALANCE_FILE = 'balance';
const USED_KEY_FILE = 'usedkey';
const KEY_PLACEHOLDER_PATTERN = /\{(cotvkey|rtkey)\}/g;

let purchaseQueue = Promise.resolve();

function enqueueBalanceMutation(operation) {
  const result = purchaseQueue.then(operation);
  purchaseQueue = result.catch(() => {});
  return result;
}

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

function getAvailableKey(content) {
  return (
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('#')) || null
  );
}

function removeKey(content, key) {
  let removed = false;
  return content
    .split(/\r?\n/)
    .filter((line) => {
      if (!removed && line.trim() === key) {
        removed = true;
        return false;
      }
      return true;
    })
    .join('\n')
    .replace(/\n*$/, '\n');
}

function appendUsedKeys(content, keys) {
  const base = content.replace(/\s*$/, '');
  return `${base ? `${base}\n` : ''}${keys.join('\n')}\n`;
}

async function executePurchase(userId, productId) {
  const { products } = await getProducts();
  const product = products.find((item) => item.id === productId);

  if (!product) {
    return { status: 'not_found' };
  }

  const balanceFile = await readDataFile(BALANCE_FILE);
  const balances = parseBalances(balanceFile.content);
  const current = balances.get(userId) || 0;

  if (current < product.price) {
    return {
      status: 'insufficient',
      balance: current,
      price: product.price,
    };
  }

  const requiredKeyFiles = [...new Set(
    Array.from(product.content.matchAll(KEY_PLACEHOLDER_PATTERN), (match) => match[1])
  )];
  const keyFiles = new Map();
  const selectedKeys = new Map();

  for (const filename of requiredKeyFiles) {
    const file = await readDataFile(filename);
    const key = getAvailableKey(file.content);

    if (!key) {
      return { status: 'out_of_stock', product };
    }

    keyFiles.set(filename, file);
    selectedKeys.set(filename, key);
  }

  balances.set(userId, current - product.price);

  const updates = [
    {
      filename: BALANCE_FILE,
      content: balancesToContent(balances),
    },
  ];

  for (const [filename, file] of keyFiles) {
    updates.push({
      filename,
      content: removeKey(file.content, selectedKeys.get(filename)),
    });
  }

  if (selectedKeys.size > 0) {
    const usedKeyFile = await readDataFile(USED_KEY_FILE);
    updates.push({
      filename: USED_KEY_FILE,
      content: appendUsedKeys(usedKeyFile.content, [...selectedKeys.values()]),
    });
  }

  await writeDataFiles(
    updates,
    `purchase: ${userId} bought ${product.name}`
  );

  const deliveryContent = product.content.replace(
    KEY_PLACEHOLDER_PATTERN,
    (_placeholder, filename) => selectedKeys.get(filename)
  );

  return {
    status: 'success',
    product: {
      ...product,
      content: deliveryContent,
    },
    balance: current - product.price,
  };
}

function purchaseProduct(userId, productId) {
  return enqueueBalanceMutation(() => executePurchase(userId, productId));
}

async function executeBalanceUpdate(userId, operation, amount = 0) {
  const file = await readDataFile(BALANCE_FILE);
  const balances = parseBalances(file.content);
  const previousBalance = balances.get(userId) || 0;
  let balance;

  switch (operation) {
    case 'add':
      balance = previousBalance + amount;
      balances.set(userId, balance);
      break;
    case 'remove':
      balance = Math.max(0, previousBalance - amount);
      balances.set(userId, balance);
      break;
    case 'set':
      balance = amount;
      balances.set(userId, balance);
      break;
    case 'clear':
      balance = 0;
      balances.delete(userId);
      break;
    default:
      throw new Error(`Unsupported balance operation: ${operation}`);
  }

  await writeDataFiles(
    [{ filename: BALANCE_FILE, content: balancesToContent(balances) }],
    `balance: ${operation} ${userId} (${previousBalance} -> ${balance})`
  );

  return { previousBalance, balance };
}

function updateBalance(userId, operation, amount) {
  if (!['add', 'remove', 'set', 'clear'].includes(operation)) {
    throw new Error('유효하지 않은 잔액 작업입니다.');
  }

  if (
    operation !== 'clear' &&
    (!Number.isSafeInteger(amount) || amount < 0)
  ) {
    throw new Error('금액은 0 이상의 안전한 정수여야 합니다.');
  }

  return enqueueBalanceMutation(() =>
    executeBalanceUpdate(userId, operation, amount)
  );
}

module.exports = {
  getProducts,
  getBalance,
  purchaseProduct,
  updateBalance,
};

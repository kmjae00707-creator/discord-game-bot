const { readDataFile, writeDataFiles } = require('./dataStore');
const { enqueue } = require('./mutationQueue');
const {
  getUserRank,
  discountedPrice,
  buildChargedUpdate,
  buildSoldUpdate,
  buildPurchaseLogUpdate,
  buildRechargeLogUpdate,
} = require('./userLedger');

const INGAME_FILE = 'ingame';
const LEGACY_SHOP_FILE = 'shop';
const BALANCE_FILE = 'balance';
const KEY_PLACEHOLDER_PATTERN = /\{(cotvkey|rtkey)\}/g;
const PENDING_KEY_FILES = {
  cotvkey: 'unusedcotvkey',
  rtkey: 'unusedrtkey',
};

const enqueueBalanceMutation = enqueue;

function parseShop(content) {
  const products = [];

  content.split(/\r?\n/).forEach((raw, lineIndex) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;

    const parts = line.split('|');
    let category;
    let name;
    let price;
    let stock;
    let productContent;

    if (parts.length >= 5 && !Number.isNaN(Number(parts[2]))) {
      category = parts[0].trim();
      name = parts[1].trim();
      price = Number(parts[2].trim());
      stock = Number(parts[3].trim());
      productContent = parts.slice(4).join('|').trim();
    } else if (parts.length >= 3) {
      category = '인게임';
      name = parts[0].trim();
      price = Number(parts[1].trim());
      stock = -1;
      productContent = parts.slice(2).join('|').trim();
    } else {
      return;
    }

    if (!category || !name || Number.isNaN(price) || price < 0 || !productContent) {
      return;
    }

    const unlimited = !Number.isSafeInteger(stock) || stock < 0;
    products.push({
      id: `p${products.length}`,
      lineIndex,
      category,
      name,
      price,
      stock: unlimited ? -1 : stock,
      unlimited,
      content: productContent,
    });
  });

  return products;
}

function serializeProductLine(product) {
  const stock = product.unlimited ? -1 : product.stock;
  return `${product.category}|${product.name}|${product.price}|${stock}|${product.content}`;
}

function replaceProductLine(fileContent, product) {
  const lines = fileContent.split(/\r?\n/);
  if (!lines[product.lineIndex]) return fileContent;
  lines[product.lineIndex] = serializeProductLine(product);
  return lines.join('\n').replace(/\n*$/, '\n');
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

async function readShopFile() {
  let file = await readDataFile(INGAME_FILE);
  if (!file.content || !file.content.trim()) {
    file = await readDataFile(LEGACY_SHOP_FILE);
    return { ...file, filename: LEGACY_SHOP_FILE };
  }
  return { ...file, filename: INGAME_FILE };
}

async function getProducts() {
  const file = await readShopFile();
  return { products: parseShop(file.content), sha: file.sha, filename: file.filename };
}

function getCategories(products) {
  const counts = new Map();
  for (const product of products) {
    counts.set(product.category, (counts.get(product.category) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
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

function appendKeys(content, keys) {
  const base = content.replace(/\s*$/, '');
  return `${base ? `${base}\n` : ''}${keys.join('\n')}\n`;
}

async function executePurchase(userId, productId) {
  const shop = await readShopFile();
  const products = parseShop(shop.content);
  const product = products.find((item) => item.id === productId);

  if (!product) {
    return { status: 'not_found' };
  }

  if (!product.unlimited && product.stock <= 0) {
    return { status: 'out_of_stock', product };
  }

  const { rank } = await getUserRank(userId);
  const price = discountedPrice(product.price, rank.discount);

  const balanceFile = await readDataFile(BALANCE_FILE);
  const balances = parseBalances(balanceFile.content);
  const current = balances.get(userId) || 0;

  if (current < price) {
    return {
      status: 'insufficient',
      balance: current,
      price,
      originalPrice: product.price,
      discount: rank.discount,
    };
  }

  const requiredKeyFiles = [
    ...new Set(
      Array.from(product.content.matchAll(KEY_PLACEHOLDER_PATTERN), (match) => match[1])
    ),
  ];
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

  balances.set(userId, current - price);

  const nextProduct = {
    ...product,
    stock: product.unlimited ? -1 : product.stock - 1,
  };

  const updates = [
    { filename: BALANCE_FILE, content: balancesToContent(balances) },
    { filename: shop.filename, content: replaceProductLine(shop.content, nextProduct) },
    await buildSoldUpdate(product),
    await buildPurchaseLogUpdate(userId, product, 1, price),
  ];

  for (const [filename, file] of keyFiles) {
    updates.push({
      filename,
      content: removeKey(file.content, selectedKeys.get(filename)),
    });
  }

  if (selectedKeys.size > 0) {
    for (const [sourceFilename, key] of selectedKeys) {
      const pendingFilename = PENDING_KEY_FILES[sourceFilename];
      const pendingFile = await readDataFile(pendingFilename);
      updates.push({
        filename: pendingFilename,
        content: appendKeys(pendingFile.content, [key]),
      });
    }
  }

  await writeDataFiles(updates, `purchase: ${userId} bought ${product.name}`);

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
    balance: current - price,
    price,
    originalPrice: product.price,
    discount: rank.discount,
  };
}

function purchaseProduct(userId, productId) {
  return enqueueBalanceMutation(() => executePurchase(userId, productId));
}

async function executeBalanceUpdate(userId, operation, amount = 0, meta = {}) {
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

  const updates = [
    { filename: BALANCE_FILE, content: balancesToContent(balances) },
  ];

  if (operation === 'add' && amount > 0 && meta.rechargeType) {
    updates.push(await buildChargedUpdate(userId, amount));
    updates.push(await buildRechargeLogUpdate(userId, amount, meta.rechargeType));
  }

  await writeDataFiles(
    updates,
    `balance: ${operation} ${userId} (${previousBalance} -> ${balance})`
  );

  return { previousBalance, balance };
}

function updateBalance(userId, operation, amount, meta = {}) {
  if (!['add', 'remove', 'set', 'clear'].includes(operation)) {
    throw new Error('유효하지 않은 잔액 작업입니다.');
  }

  if (operation !== 'clear' && (!Number.isSafeInteger(amount) || amount < 0)) {
    throw new Error('금액은 0 이상의 안전한 정수여야 합니다.');
  }

  return enqueueBalanceMutation(() =>
    executeBalanceUpdate(userId, operation, amount, meta)
  );
}

module.exports = {
  getProducts,
  getCategories,
  getBalance,
  purchaseProduct,
  updateBalance,
  parseBalances,
  balancesToContent,
  BALANCE_FILE,
};

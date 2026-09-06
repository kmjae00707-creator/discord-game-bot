const { readDataFile, writeDataFiles, useGitHub } = require('./dataStore');

const FILES = {
  cotv: 'unusedcotvkey',
  rt: 'unusedrtkey',
  used: 'usedkey',
};

const CHANNELS = {
  cotv: '1540265193743978506',
  rt: '1540265091948224586',
};

const ROLES = {
  cotv: '1539990567285555381',
  rt: '1540297300092526592',
};

function normalizeKeys(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function keysToContent(keys) {
  if (keys.length === 0) return '';
  return `${keys.join('\n')}\n`;
}

let redeemQueue = Promise.resolve();

/**
 * @returns {Promise<{ status: 'success' | 'used' | 'invalid', type?: 'cotv' | 'rt' }>}
 */
async function executeRedeem(rawKey) {
  const key = rawKey.trim();
  if (!key) {
    return { status: 'invalid' };
  }

  const [cotvFile, rtFile, usedFile] = await Promise.all([
    readDataFile(FILES.cotv),
    readDataFile(FILES.rt),
    readDataFile(FILES.used),
  ]);

  const cotvKeys = normalizeKeys(cotvFile.content);
  const rtKeys = normalizeKeys(rtFile.content);
  const usedKeys = normalizeKeys(usedFile.content);

  if (usedKeys.includes(key)) {
    return { status: 'used' };
  }

  const isCotv = cotvKeys.includes(key);
  const isRt = rtKeys.includes(key);

  if (!isCotv && !isRt) {
    return { status: 'invalid' };
  }

  const type = isCotv ? 'cotv' : 'rt';
  const sourceKeys = isCotv ? cotvKeys : rtKeys;
  const sourceFilename = isCotv ? FILES.cotv : FILES.rt;

  const updatedSourceKeys = sourceKeys.filter((item) => item !== key);
  const updatedUsedKeys = [...usedKeys, key];

  await writeDataFiles(
    [
      {
        filename: sourceFilename,
        content: keysToContent(updatedSourceKeys),
      },
      {
        filename: FILES.used,
        content: keysToContent(updatedUsedKeys),
      },
    ],
    `redeem: add used key (${type})`
  );

  return { status: 'success', type };
}

function redeemKey(rawKey) {
  const redemption = redeemQueue.then(() => executeRedeem(rawKey));
  redeemQueue = redemption.catch(() => {});
  return redemption;
}

function getPurchaseChannelId(type) {
  return CHANNELS[type];
}

function getPurchaseMessage(displayName, type) {
  if (type === 'cotv') {
    return `${displayName}님이 cotv를 구매하였습니다`;
  }
  return `${displayName}님이 rt를 구매하였습니다`;
}

function getPurchaseRoleId(type) {
  return ROLES[type];
}

module.exports = {
  redeemKey,
  getPurchaseChannelId,
  getPurchaseMessage,
  getPurchaseRoleId,
  useGitHub,
};

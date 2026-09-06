const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILES = {
  cotv: 'cotvkey',
  rt: 'rtkey',
  used: 'usedkey',
};

const CHANNELS = {
  cotv: '1540265193743978506',
  rt: '1540265091948224586',
};

let octokit = null;

function useGitHub() {
  return Boolean(
    process.env.GITHUB_TOKEN &&
      process.env.GITHUB_OWNER &&
      process.env.GITHUB_REPO
  );
}

function getOctokit() {
  if (!octokit) {
    octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  }
  return octokit;
}

function normalizeKeys(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function keysToContent(keys) {
  if (keys.length === 0) return '';
  return `${keys.join('\n')}\n`;
}

async function readFileFromGitHub(filename) {
  const api = getOctokit();
  const filePath = `data/${filename}`;

  try {
    const { data } = await api.repos.getContent({
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      path: filePath,
    });

    if (Array.isArray(data) || !('content' in data)) {
      throw new Error(`Unexpected GitHub response for ${filePath}`);
    }

    const content = Buffer.from(data.content, 'base64').toString('utf8');
    return { content, sha: data.sha };
  } catch (error) {
    if (error.status === 404) {
      return { content: '', sha: null };
    }
    throw error;
  }
}

function readFileLocal(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return { content: '', sha: null };
  }
  return { content: fs.readFileSync(filePath, 'utf8'), sha: null };
}

async function readKeyFile(filename) {
  if (useGitHub()) {
    return readFileFromGitHub(filename);
  }
  return readFileLocal(filename);
}

async function writeFileToGitHub(filename, content, sha, message) {
  const api = getOctokit();
  const filePath = `data/${filename}`;

  await api.repos.createOrUpdateFileContents({
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
    path: filePath,
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    sha: sha || undefined,
  });
}

function writeFileLocal(filename, content) {
  const filePath = path.join(DATA_DIR, filename);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

async function writeKeyFile(filename, content, sha, message) {
  if (useGitHub()) {
    await writeFileToGitHub(filename, content, sha, message);
    return;
  }
  writeFileLocal(filename, content);
}

/**
 * @returns {Promise<{ status: 'success' | 'used' | 'invalid', type?: 'cotv' | 'rt' }>}
 */
async function redeemKey(rawKey) {
  const key = rawKey.trim();
  if (!key) {
    return { status: 'invalid' };
  }

  const [cotvFile, rtFile, usedFile] = await Promise.all([
    readKeyFile(FILES.cotv),
    readKeyFile(FILES.rt),
    readKeyFile(FILES.used),
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
  const sourceFile = isCotv ? cotvFile : rtFile;
  const sourceFilename = isCotv ? FILES.cotv : FILES.rt;

  const updatedSourceKeys = sourceKeys.filter((item) => item !== key);
  const updatedUsedKeys = [...usedKeys, key];

  await writeKeyFile(
    sourceFilename,
    keysToContent(updatedSourceKeys),
    sourceFile.sha,
    `redeem: move key to used (${type})`
  );

  await writeKeyFile(
    FILES.used,
    keysToContent(updatedUsedKeys),
    usedFile.sha,
    `redeem: add used key (${type})`
  );

  return { status: 'success', type };
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

module.exports = {
  redeemKey,
  getPurchaseChannelId,
  getPurchaseMessage,
  useGitHub,
};

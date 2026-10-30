const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { deferEphemeral } = require('../utils/interactionResponse');

const ASSET_NAME = 'AfkWatch-Setup.exe';
const DEFAULT_OWNER = 'kmjae00707-creator';
const DEFAULT_REPO = 'discord-game-bot';

function repoCoordinates() {
  const owner = process.env.GITHUB_OWNER?.trim() || DEFAULT_OWNER;
  const repo = process.env.GITHUB_REPO?.trim() || DEFAULT_REPO;
  return { owner, repo };
}

function githubHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'discord-game-bot',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/**
 * 저장소 릴리스에서 AFK Watch 설치 파일을 찾는다.
 * @returns {Promise<{ version: string, url: string, name: string }>}
 */
async function findInstaller() {
  const { owner, repo } = repoCoordinates();
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=30`,
    { headers: githubHeaders(), signal: AbortSignal.timeout(15_000) }
  );
  if (!response.ok) {
    throw new Error(`GitHub releases failed (${response.status})`);
  }

  const releases = await response.json();
  if (!Array.isArray(releases)) {
    throw new Error('GitHub releases response was not a list');
  }

  for (const release of releases) {
    const asset = (release.assets || []).find((item) => item?.name === ASSET_NAME);
    if (!asset?.browser_download_url) {
      continue;
    }
    return {
      version: release.tag_name || release.name || 'AFK Watch',
      url: asset.browser_download_url,
      name: asset.name,
    };
  }

  throw new Error('installer asset missing');
}

async function downloadInstaller(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'discord-game-bot', Accept: 'application/octet-stream' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`installer download failed (${response.status})`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length < 1024) {
    throw new Error('installer download was empty');
  }
  return data;
}

const downloadCommand = {
  data: new SlashCommandBuilder()
    .setName('download')
    .setDescription('AFK Watch 설치 파일을 받습니다.')
    .setDMPermission(false),

  async execute(interaction) {
    await deferEphemeral(interaction);
    try {
      const installer = await findInstaller();
      const file = await downloadInstaller(installer.url);
      await interaction.editReply({
        content: `AFK Watch 설치 파일입니다. (${installer.version})`,
        files: [new AttachmentBuilder(file, { name: installer.name })],
      });
    } catch (error) {
      console.error('download failed:', error);
      await interaction.editReply({
        content: '설치 파일을 가져오지 못했습니다. 잠시 뒤에 다시 시도해 주세요.',
      });
    }
  },
};

module.exports = {
  downloadCommand,
  findInstaller,
};

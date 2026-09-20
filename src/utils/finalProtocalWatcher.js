const { ChannelType } = require('discord.js');
const { readDataFile, writeDataFile } = require('./dataStore');

const FILE = 'finalprotocal';
const TARGET_GUILD_ID = '1533500107331207289';
const NEW_CHANNEL_NAME = '소통방';
const POLL_INTERVAL_MS = 30_000;
const DELETE_DELAY_MS = 500;

let pollTimer = null;
let running = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeValue(content) {
  return (content || '').trim().toLowerCase();
}

async function deleteDeletableRoles(guild) {
  const botMember = await guild.members.fetchMe();
  const botHighestPosition = botMember.roles.highest.position;

  const roles = await guild.roles.fetch();
  const targetRoles = [...roles.values()]
    .filter(Boolean)
    .filter((role) => role.id !== guild.id)
    .filter((role) => role.position < botHighestPosition)
    .sort((a, b) => b.position - a.position);

  let deletedCount = 0;

  for (const role of targetRoles) {
    if (role.managed) {
      console.warn(`[finalprotocal] 연동 역할은 건너뜀 (${role.id}, ${role.name})`);
      continue;
    }

    try {
      await role.delete('finalprotocal: yes');
      deletedCount += 1;
      await sleep(DELETE_DELAY_MS);
    } catch (error) {
      console.error(`[finalprotocal] 역할 삭제 실패 (${role.id}, ${role.name}):`, error.message);
      throw error;
    }
  }

  console.log(`[finalprotocal] 역할 ${deletedCount}개 삭제 완료`);
}

async function deleteAllChannels(guild) {
  const fetched = await guild.channels.fetch();
  const channels = [...fetched.values()].filter(Boolean);

  const categories = channels.filter((channel) => channel.type === ChannelType.GuildCategory);
  const others = channels.filter((channel) => channel.type !== ChannelType.GuildCategory);

  for (const channel of others) {
    try {
      await channel.delete('finalprotocal: yes');
      await sleep(DELETE_DELAY_MS);
    } catch (error) {
      console.error(`[finalprotocal] 채널 삭제 실패 (${channel.id}):`, error.message);
      throw error;
    }
  }

  for (const category of categories) {
    try {
      await category.delete('finalprotocal: yes');
      await sleep(DELETE_DELAY_MS);
    } catch (error) {
      console.error(`[finalprotocal] 카테고리 삭제 실패 (${category.id}):`, error.message);
      throw error;
    }
  }
}

async function cleanupGuild(client) {
  const guild = await client.guilds.fetch(TARGET_GUILD_ID);

  await deleteAllChannels(guild);
  await deleteDeletableRoles(guild);

  const created = await guild.channels.create({
    name: NEW_CHANNEL_NAME,
    reason: 'finalprotocal: yes',
  });

  console.log(`[finalprotocal] "${NEW_CHANNEL_NAME}" 채널 생성 완료 (${created.id})`);
}

async function resetToNo(sha) {
  await writeDataFile(FILE, 'no\n', sha, 'finalprotocal: reset to no after guild cleanup');
}

async function checkAndExecute(client) {
  if (running || !client?.isReady()) {
    return;
  }

  running = true;

  try {
    const file = await readDataFile(FILE);
    const value = normalizeValue(file.content);

    if (value !== 'yes') {
      return;
    }

    console.log(`[finalprotocal] yes 감지 - 서버 ${TARGET_GUILD_ID} 채널/역할 정리 시작`);

    await cleanupGuild(client);
    await resetToNo(file.sha);

    console.log('[finalprotocal] 채널/역할 정리 완료, finalprotocal=no 로 되돌림');
  } catch (error) {
    console.error('[finalprotocal] 처리 실패:', error);
  } finally {
    running = false;
  }
}

function startFinalProtocalWatcher(client) {
  if (pollTimer) {
    return;
  }

  checkAndExecute(client).catch((error) => {
    console.error('[finalprotocal] 초기 확인 실패:', error);
  });

  pollTimer = setInterval(() => {
    checkAndExecute(client).catch((error) => {
      console.error('[finalprotocal] 주기 확인 실패:', error);
    });
  }, POLL_INTERVAL_MS);

  console.log(`[finalprotocal] 감시 시작 (${POLL_INTERVAL_MS / 1000}s 간격)`);
}

function stopFinalProtocalWatcher() {
  if (!pollTimer) {
    return;
  }

  clearInterval(pollTimer);
  pollTimer = null;
}

module.exports = {
  startFinalProtocalWatcher,
  stopFinalProtocalWatcher,
};

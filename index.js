require('dotenv').config();

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const http = require('http');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Events,
} = require('discord.js');

const { tictaktoCommand, handleTttButton } = require('./src/commands/tictakto');
const { redeemCommand } = require('./src/commands/redeem');
const { dashboardCommand } = require('./src/commands/dashboard');
const { handleDashboardButton, handleDashboardSelect } = require('./src/handlers/dashboardHandler');

function getClientIdFromToken(botToken) {
  try {
    return Buffer.from(botToken.split('.')[0], 'base64').toString('utf8');
  } catch {
    return null;
  }
}

const token = process.env.DISCORD_TOKEN?.trim();
const clientId =
  process.env.DISCORD_CLIENT_ID?.trim() || (token ? getClientIdFromToken(token) : null);

if (!token) {
  console.error('DISCORD_TOKEN 환경 변수가 필요합니다.');
  process.exit(1);
}

if (!clientId) {
  console.error('DISCORD_CLIENT_ID를 찾을 수 없습니다. 토큰을 확인해 주세요.');
  process.exit(1);
}

console.log(`Starting bot (clientId: ${clientId}, token length: ${token.length})`);

const commands = [
  tictaktoCommand.data.toJSON(),
  redeemCommand.data.toJSON(),
  dashboardCommand.data.toJSON(),
];

/** @type {Client | null} */
let client = null;
let commandsRegistered = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registerCommands() {
  if (commandsRegistered) return;

  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  commandsRegistered = true;
  console.log('Slash commands registered.');
}

function attachClientHandlers(discordClient) {
  discordClient.on(Events.Error, (error) => {
    console.error('Discord client error:', error);
  });

  discordClient.on(Events.Warn, (message) => {
    console.warn('Discord client warn:', message);
  });

  discordClient.on(Events.ShardDisconnect, (event, shardId) => {
    console.error(`Shard ${shardId} disconnected:`, event.code, event.reason);
  });

  discordClient.on(Events.ShardError, (error, shardId) => {
    console.error(`Shard ${shardId} error:`, error);
  });

  discordClient.once(Events.ClientReady, async (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
    try {
      await registerCommands();
    } catch (error) {
      console.error('Slash command registration failed:', error);
    }
  });

  discordClient.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'tictakto') {
          await tictaktoCommand.execute(interaction);
          return;
        }

        if (interaction.commandName === 'redeem') {
          await redeemCommand.execute(interaction);
          return;
        }

        if (interaction.commandName === 'dashboard') {
          await dashboardCommand.execute(interaction);
        }
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith('dash|')) {
        await handleDashboardButton(interaction);
        return;
      }

      if (interaction.isStringSelectMenu() && interaction.customId === 'dash|buy') {
        await handleDashboardSelect(interaction);
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith('ttt|')) {
        await handleTttButton(interaction);
      }
    } catch (error) {
      console.error('Interaction error:', error);

      const payload = {
        content: '명령 처리 중 오류가 발생했습니다.',
        ephemeral: true,
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  });
}

function createClient() {
  const discordClient = new Client({
    intents: [GatewayIntentBits.Guilds],
    rest: { timeout: 30_000 },
  });

  attachClientHandlers(discordClient);
  return discordClient;
}

async function destroyClient() {
  if (!client) return;
  try {
    await client.destroy();
  } catch (error) {
    console.error('Client destroy error:', error.message);
  }
  client = null;
}

async function connectDiscordLoop() {
  let attempt = 0;

  while (true) {
    attempt += 1;

    if (client?.isReady()) {
      await sleep(30000);
      continue;
    }

    await destroyClient();
    client = createClient();

    console.log(`Discord login attempt #${attempt}...`);

    try {
      await Promise.race([
        client.login(token),
        sleep(120_000).then(() => {
          throw new Error('Discord login timeout (120s)');
        }),
      ]);

      console.log('Discord login completed.');
      await sleep(30000);
    } catch (error) {
      console.error(`Discord login failed (attempt #${attempt}):`, error.message);
      await destroyClient();
      await sleep(15_000);
    }
  }
}

function startHealthServer() {
  const port = Number(process.env.PORT) || 3000;

  http
    .createServer((_req, res) => {
      const ready = client?.isReady() ? 'online' : 'connecting';
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Discord bot is running (${ready})`);
    })
    .listen(port, () => {
      console.log(`Health server listening on port ${port}`);
    });
}

function startKeepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!url) {
    console.log('Keep-alive skipped (RENDER_EXTERNAL_URL not set)');
    return;
  }

  const ping = () => {
    fetch(url)
      .then(() => console.log('Keep-alive ping ok'))
      .catch((error) => console.error('Keep-alive ping failed:', error.message));
  };

  ping();
  setInterval(ping, 14 * 60 * 1000);
}

function start() {
  startHealthServer();
  startKeepAlive();
  connectDiscordLoop().catch((error) => {
    console.error('Discord connect loop crashed:', error);
  });
}

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

start();

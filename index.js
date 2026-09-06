require('dotenv').config();

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
let discordLoginStarted = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registerCommands() {
  if (commandsRegistered) return;

  const rest = new REST({
    version: '10',
    timeout: 30_000,
    rejectOnRateLimit: () => true,
  }).setToken(token);
  rest.on('rateLimited', (info) => {
    console.warn(
      `Discord REST rate limited: route=${info.route}, retryAfter=${info.retryAfter}ms`
    );
  });

  console.log('Registering slash commands...');
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  commandsRegistered = true;
  console.log(
    `Slash commands registered: ${commands.map((command) => command.name).join(', ')}`
  );
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

  discordClient.once(Events.ClientReady, (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
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
    rest: {
      timeout: 30_000,
      rejectOnRateLimit: () => true,
    },
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
  if (discordLoginStarted) return;
  discordLoginStarted = true;

  client = createClient();
  console.log('Connecting to Discord Gateway (waiting through rate limits)...');

  try {
    await client.login(token);
    console.log('Discord login completed.');
  } catch (error) {
    console.error('Discord login failed:', error);
    discordLoginStarted = false;
    await destroyClient();

    console.log('Retrying Discord login in 30 seconds...');
    await sleep(30_000);
    connectDiscordLoop().catch((retryError) => {
      console.error('Discord reconnect failed:', retryError);
    });
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

async function registerCommandsWithRetry() {
  try {
    await registerCommands();
  } catch (error) {
    console.error('Slash command registration failed:', error);
    console.log('Retrying slash command registration in 60 seconds...');
    setTimeout(() => {
      registerCommandsWithRetry().catch((retryError) => {
        console.error('Slash command registration retry crashed:', retryError);
      });
    }, 60_000);
  }
}

function start() {
  startHealthServer();
  startKeepAlive();
  registerCommandsWithRetry().catch((error) => {
    console.error('Slash command registration crashed:', error);
  });
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

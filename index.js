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
const { balanceCommand } = require('./src/commands/balance');
const { gppointCommand } = require('./src/commands/gppoint');
const { slotCommand } = require('./src/commands/slot');
const {
  handleDashboardButton,
  handleDashboardSelect,
  handleChargeModalSubmit,
  handleMismatchFixModalSubmit,
  handleRobuxModalSubmit,
  handleGpModalSubmit,
  CHARGE_MODAL_ID,
  MFIX_MODAL_PREFIX,
  ROBUX_MODAL_ID,
  GP_MODAL_ID,
} = require('./src/handlers/dashboardHandler');
const { processDeposit } = require('./src/handlers/depositHandler');

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
  balanceCommand.data.toJSON(),
  gppointCommand.data.toJSON(),
  slotCommand.data.toJSON(),
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
          return;
        }

        if (interaction.commandName === 'balance') {
          await balanceCommand.execute(interaction);
          return;
        }

        if (interaction.commandName === 'gppoint') {
          await gppointCommand.execute(interaction);
          return;
        }

        if (interaction.commandName === 'slot') {
          await slotCommand.execute(interaction);
        }
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith('dash|')) {
        await handleDashboardButton(interaction);
        return;
      }

      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('dash|')) {
        await handleDashboardSelect(interaction);
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId === CHARGE_MODAL_ID) {
        await handleChargeModalSubmit(interaction);
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId === ROBUX_MODAL_ID) {
        await handleRobuxModalSubmit(interaction);
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId === GP_MODAL_ID) {
        await handleGpModalSubmit(interaction);
        return;
      }

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(MFIX_MODAL_PREFIX)
      ) {
        await handleMismatchFixModalSubmit(interaction);
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
    shards: [0],
    shardCount: 1,
    rest: {
      timeout: 30_000,
    },
  });

  // Render의 공유 IP는 Discord /gateway/bot 전역 제한에 걸릴 수 있습니다.
  // 이 봇은 단일 샤드이므로 Render에서 해당 조회만 안전한 고정 정보로 대체합니다.
  if (process.env.RENDER_EXTERNAL_URL) {
    const originalGet = discordClient.rest.get.bind(discordClient.rest);

    discordClient.rest.get = (route, options) => {
      if (route === Routes.gatewayBot()) {
        console.log('Using single-shard Discord Gateway configuration on Render.');
        return Promise.resolve({
          url: 'wss://gateway.discord.gg',
          shards: 1,
          session_start_limit: {
            total: 1_000,
            remaining: 1_000,
            reset_after: 5_000,
            max_concurrency: 1,
          },
        });
      }

      return originalGet(route, options);
    };
  }

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

function readRequestBody(req, limitBytes = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function handleDepositRequest(req, res) {
  const secret = process.env.DEPOSIT_SECRET?.trim();

  if (!secret) {
    sendJson(res, 503, { ok: false, error: 'deposit_secret_not_configured' });
    return;
  }

  const provided = (req.headers['x-deposit-secret'] || '').toString().trim();
  if (provided !== secret) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' });
    return;
  }

  let raw;
  try {
    raw = await readRequestBody(req);
  } catch (error) {
    sendJson(res, 413, { ok: false, error: error.message });
    return;
  }

  let body = raw;
  const contentType = (req.headers['content-type'] || '').toString();
  if (contentType.includes('application/json')) {
    try {
      body = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { ok: false, error: 'invalid_json' });
      return;
    }
  }

  try {
    const result = await processDeposit(client, body);
    const statusCode = result.ok ? 200 : 422;
    sendJson(res, statusCode, result);
  } catch (error) {
    console.error('[deposit] webhook error:', error);
    sendJson(res, 500, { ok: false, error: 'internal_error' });
  }
}

function startHealthServer() {
  const port = Number(process.env.PORT) || 3000;

  http
    .createServer((req, res) => {
      const url = (req.url || '/').split('?')[0];

      if (req.method === 'POST' && url === '/deposit') {
        handleDepositRequest(req, res).catch((error) => {
          console.error('[deposit] unhandled webhook error:', error);
          if (!res.headersSent) {
            sendJson(res, 500, { ok: false, error: 'internal_error' });
          }
        });
        return;
      }

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

  if (process.env.REGISTER_COMMANDS !== 'false') {
    registerCommandsWithRetry().catch((error) => {
      console.error('Slash command registration crashed:', error);
    });
  } else {
    console.log('Slash command registration disabled by REGISTER_COMMANDS=false.');
  }

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

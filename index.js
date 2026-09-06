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
const {
  handleDashboardButton,
  handleDashboardSelect,
} = require('./src/handlers/dashboardHandler');

const token = process.env.DISCORD_TOKEN?.trim();
const clientId = process.env.DISCORD_CLIENT_ID?.trim();

if (!token || !clientId) {
  console.error('DISCORD_TOKEN과 DISCORD_CLIENT_ID 환경 변수가 필요합니다.');
  console.error(`DISCORD_TOKEN: ${token ? 'set' : 'missing'}`);
  console.error(`DISCORD_CLIENT_ID: ${clientId ? 'set' : 'missing'}`);
  process.exit(1);
}

console.log(`Starting bot (clientId: ${clientId}, token length: ${token.length})`);

const commands = [
  tictaktoCommand.data.toJSON(),
  redeemCommand.data.toJSON(),
  dashboardCommand.data.toJSON(),
];

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  rest: { timeout: 30_000 },
});

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log('Slash commands registered.');
}

client.on(Events.Error, (error) => {
  console.error('Discord client error:', error);
});

client.on(Events.Warn, (message) => {
  console.warn('Discord client warn:', message);
});

client.on(Events.ShardDisconnect, (event, shardId) => {
  console.error(`Shard ${shardId} disconnected:`, event.code, event.reason);
});

client.on(Events.ShardError, (error, shardId) => {
  console.error(`Shard ${shardId} error:`, error);
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  try {
    await registerCommands();
  } catch (error) {
    console.error('Slash command registration failed:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
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

function startHealthServer() {
  const port = Number(process.env.PORT) || 3000;

  http
    .createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Discord bot is running');
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

async function start() {
  console.log('Connecting to Discord...');

  const loginTimeoutMs = 60000;
  await Promise.race([
    client.login(token),
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`Discord login timeout (${loginTimeoutMs / 1000}s)`)),
        loginTimeoutMs
      );
    }),
  ]);

  console.log('Discord login completed.');

  startHealthServer();
  startKeepAlive();
}

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

start().catch((error) => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});

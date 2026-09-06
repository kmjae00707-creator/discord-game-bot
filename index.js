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

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  console.error('DISCORD_TOKEN과 DISCORD_CLIENT_ID 환경 변수가 필요합니다.');
  process.exit(1);
}

const commands = [tictaktoCommand.data.toJSON(), redeemCommand.data.toJSON()];

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log('Slash commands registered.');
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
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
      }
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

async function start() {
  startHealthServer();
  await registerCommands();
  await client.login(token);
}

start().catch((error) => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});

const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const cron = require('node-cron');
const config = require('./config');
const { runPollCycle } = require('./services/poller');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

client.once('ready', () => {
  console.log(`✅ Bot login sebagai ${client.user.tag}`);

  // Jalanin polling pertama kali begitu bot online
  runPollCycle(client).catch((err) => console.error('[poller] Error di cycle pertama:', err));

  // Jadwalin polling berkala sesuai interval di .env
  const cronExpr = `*/${config.pollIntervalMinutes} * * * *`;
  cron.schedule(cronExpr, () => {
    runPollCycle(client).catch((err) => console.error('[poller] Error di scheduled cycle:', err));
  });

  console.log(`⏰ Polling dijadwalin tiap ${config.pollIntervalMinutes} menit.`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error di command ${interaction.commandName}:`, err);
    const payload = { content: 'Ada error pas jalanin command ini bro.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  }
});

client.login(config.discordToken);

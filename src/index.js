const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const cron = require('node-cron');
const config = require('./config');
const { runHotScan, runCoverageScan } = require('./services/poller');

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

  // Jalanin sekali di awal
  runHotScan(client).catch((err) => console.error('[poller:hot] Error di scan pertama:', err));
  runCoverageScan(client).catch((err) => console.error('[poller:coverage] Error di cycle pertama:', err));

  // Jalur cepat - selalu cek halaman terbaru, interval pendek
  cron.schedule(`*/${config.hotIntervalSeconds} * * * * *`, () => {
    runHotScan(client).catch((err) => console.error('[poller:hot] Error:', err));
  });

  // Jalur coverage - rotating scan, interval lebih panjang
  cron.schedule(`*/${config.pollIntervalSeconds} * * * * *`, () => {
    runCoverageScan(client).catch((err) => console.error('[poller:coverage] Error:', err));
  });

  console.log(`⏰ Hot lane tiap ${config.hotIntervalSeconds} detik | Coverage lane tiap ${config.pollIntervalSeconds} detik.`);
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

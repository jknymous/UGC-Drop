const { SlashCommandBuilder } = require('discord.js');
const { runPollCycle } = require('../services/poller');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('forcecheck')
    .setDescription('Paksa bot cek UGC free sekarang juga (skip nunggu interval)'),

  async execute(interaction) {
    if (config.adminRoleId && !interaction.member.roles.cache.has(config.adminRoleId)) {
      return interaction.reply({ content: 'Lu ga punya izin buat command ini bro.', ephemeral: true });
    }

    await interaction.reply({ content: '🔄 Lagi cek UGC free terbaru, tunggu bentar...', ephemeral: true });
    try {
      await runPollCycle(interaction.client);
      await interaction.followUp({ content: '✅ Selesai cek. Cek channel live buat hasilnya.', ephemeral: true });
    } catch (err) {
      console.error(err);
      await interaction.followUp({ content: `❌ Error: ${err.message}`, ephemeral: true });
    }
  },
};

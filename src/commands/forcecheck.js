const { SlashCommandBuilder } = require('discord.js');
const { runHotScan, runCoverageScan } = require('../services/poller');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('forcecheck')
    .setDescription('Paksa bot cek UGC free sekarang juga (skip nunggu interval)')
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('Mode cek: hot (halaman terbaru doang) atau coverage (rotating scan penuh)')
        .setRequired(false)
        .addChoices(
          { name: 'hot (cepet, halaman terbaru)', value: 'hot' },
          { name: 'coverage (rotating scan penuh)', value: 'coverage' }
        )
    ),

  async execute(interaction) {
    if (config.adminRoleId && !interaction.member.roles.cache.has(config.adminRoleId)) {
      return interaction.reply({ content: 'Lu ga punya izin buat command ini bro.', ephemeral: true });
    }

    const mode = interaction.options.getString('mode') || 'hot';
    await interaction.reply({ content: `🔄 Lagi cek UGC free (mode: ${mode}), tunggu bentar...`, ephemeral: true });

    try {
      if (mode === 'coverage') {
        await runCoverageScan(interaction.client);
      } else {
        await runHotScan(interaction.client);
      }
      await interaction.followUp({ content: '✅ Selesai cek. Cek channel live buat hasilnya.', ephemeral: true });
    } catch (err) {
      console.error(err);
      await interaction.followUp({ content: `❌ Error: ${err.message}`, ephemeral: true });
    }
  },
};

const { SlashCommandBuilder } = require('discord.js');
const db = require('../database/db');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listblocked')
    .setDescription('Liat daftar map yang lagi di-blok, atau hapus blokirnya')
    .addIntegerOption((opt) =>
      opt
        .setName('unblock_id')
        .setDescription('ID blokir yang mau dihapus (liat dulu list-nya, ID ada di kolom paling kiri)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const unblockId = interaction.options.getInteger('unblock_id');

    if (unblockId) {
      if (config.adminRoleId && !interaction.member.roles.cache.has(config.adminRoleId)) {
        return interaction.reply({ content: 'Lu ga punya izin buat command ini bro.', ephemeral: true });
      }
      db.removeBlockedMap(unblockId);
      return interaction.reply({ content: `✅ Blokir dengan ID \`${unblockId}\` udah dihapus.`, ephemeral: true });
    }

    const blocked = db.getBlockedMaps();
    if (!blocked.length) {
      return interaction.reply({ content: 'Belum ada map yang di-blok.', ephemeral: true });
    }

    const lines = blocked.map(
      (b) => `\`${b.id}\` - **${b.game_name_pattern}**${b.universe_id ? ` (universe: ${b.universe_id})` : ''} - by ${b.blocked_by}`
    );

    await interaction.reply({
      content: `**Daftar map yang di-blok:**\n${lines.join('\n')}\n\nBuat unblock, jalanin \`/listblocked unblock_id:<ID>\``,
      ephemeral: true,
    });
  },
};

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database/db');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addmapinfo')
    .setDescription('Set manual info map/game buat UGC item (kalau API ga kasih data otomatis)')
    .addIntegerOption((opt) =>
      opt.setName('item_id').setDescription('Roblox Item/Asset ID').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('game_name').setDescription('Nama game/map-nya').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('game_url').setDescription('Link ke game-nya (opsional)').setRequired(false)
    ),

  async execute(interaction) {
    if (config.adminRoleId && !interaction.member.roles.cache.has(config.adminRoleId)) {
      return interaction.reply({ content: 'Lu ga punya izin buat command ini bro.', ephemeral: true });
    }

    const itemId = interaction.options.getInteger('item_id');
    const gameName = interaction.options.getString('game_name');
    const gameUrl = interaction.options.getString('game_url') || null;

    db.setMapOverride(itemId, gameName, gameUrl, interaction.user.tag);

    await interaction.reply({
      content: `✅ Map info buat item \`${itemId}\` di-set jadi **${gameName}**. Bakal kepake di update berikutnya.`,
      ephemeral: true,
    });
  },
};

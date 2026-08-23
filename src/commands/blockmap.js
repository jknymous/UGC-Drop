const { SlashCommandBuilder } = require('discord.js');
const db = require('../database/db');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blockmap')
    .setDescription('Skip UGC dari map/game tertentu biar ga keposting (misal map spam)')
    .addStringOption((opt) =>
      opt
        .setName('game_name')
        .setDescription('Nama game/map yang mau di-skip (partial match, ga case-sensitive)')
        .setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('universe_id')
        .setDescription('Universe ID game-nya (opsional, lebih presisi daripada nama)')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (config.adminRoleId && !interaction.member.roles.cache.has(config.adminRoleId)) {
      return interaction.reply({ content: 'Lu ga punya izin buat command ini bro.', ephemeral: true });
    }

    const gameName = interaction.options.getString('game_name');
    const universeId = interaction.options.getInteger('universe_id');

    db.addBlockedMap(gameName, universeId, interaction.user.tag);

    await interaction.reply({
      content: `🚫 Map **${gameName}** di-blok. UGC dari map ini bakal di-skip mulai polling berikutnya (nggak keposting sama sekali).`,
      ephemeral: true,
    });
  },
};

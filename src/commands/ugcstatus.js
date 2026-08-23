const { SlashCommandBuilder } = require('discord.js');
const db = require('../database/db');
const { buildActiveEmbed, buildSoldOutEmbed } = require('../services/embedBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ugcstatus')
    .setDescription('Cek status stock UGC item tertentu yang lagi di-track bot')
    .addIntegerOption((opt) =>
      opt.setName('item_id').setDescription('Roblox Item/Asset ID').setRequired(true)
    ),

  async execute(interaction) {
    const itemId = interaction.options.getInteger('item_id');
    const item = db.getItem(itemId);

    if (!item) {
      return interaction.reply({
        content: `Item \`${itemId}\` belum pernah ke-track sama bot. Coba \`/forcecheck\` dulu atau tunggu polling berikutnya.`,
        ephemeral: true,
      });
    }

    const mapped = {
      itemId: item.item_id,
      name: item.name,
      creatorName: item.creator_name,
      thumbnailUrl: item.thumbnail_url,
      gameName: item.game_name,
      gameUrl: item.game_url,
      quantityTotal: item.quantity_total,
      quantityRemaining: item.quantity_remaining,
    };

    const embed = item.status === 'soldout' ? buildSoldOutEmbed(mapped) : buildActiveEmbed(mapped);
    await interaction.reply({ embeds: [embed] });
  },
};

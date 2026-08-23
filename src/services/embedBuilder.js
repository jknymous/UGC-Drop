const { EmbedBuilder } = require('discord.js');

function buildActiveEmbed(item) {
  const embed = new EmbedBuilder()
    .setTitle(`🎁 ${item.name}`)
    .setColor(0x57f287) // hijau = masih available
    .setURL(`https://www.roblox.com/catalog/${item.itemId}`)
    .addFields(
      { name: 'Creator', value: item.creatorName || 'Unknown', inline: true },
      { name: 'Harga', value: 'FREE', inline: true },
      {
        name: 'Stock',
        value: item.quantityTotal
          ? `${item.quantityRemaining} / ${item.quantityTotal}`
          : 'Unlimited / Unknown',
        inline: true,
      }
    )
    .setTimestamp();

  if (item.thumbnailUrl) embed.setThumbnail(item.thumbnailUrl);

  if (item.gameName) {
    embed.addFields({
      name: 'Map / Game',
      value: item.gameUrl ? `[${item.gameName}](${item.gameUrl})` : item.gameName,
    });
  } else {
    embed.addFields({
      name: 'Map / Game',
      value: '_Belum diketahui - claim langsung dari catalog page_',
    });
  }

  embed.setFooter({ text: `Item ID: ${item.itemId}` });
  return embed;
}

function buildSoldOutEmbed(item) {
  const embed = new EmbedBuilder()
    .setTitle(`❌ ${item.name} - SOLD OUT`)
    .setColor(0xed4245) // merah = habis
    .setURL(`https://www.roblox.com/catalog/${item.itemId}`)
    .addFields(
      { name: 'Creator', value: item.creatorName || 'Unknown', inline: true },
      { name: 'Total Stock', value: `${item.quantityTotal ?? 'Unknown'}`, inline: true }
    )
    .setTimestamp();

  if (item.thumbnailUrl) embed.setThumbnail(item.thumbnailUrl);
  if (item.gameName) {
    embed.addFields({
      name: 'Map / Game',
      value: item.gameUrl ? `[${item.gameName}](${item.gameUrl})` : item.gameName,
    });
  }
  embed.setFooter({ text: `Item ID: ${item.itemId}` });
  return embed;
}

module.exports = { buildActiveEmbed, buildSoldOutEmbed };

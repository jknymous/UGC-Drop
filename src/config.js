require('dotenv').config();

function required(name) {
  const val = process.env[name];
  if (!val) {
    console.warn(`[config] WARNING: env var ${name} belum di-set. Cek file .env lu.`);
  }
  return val;
}

module.exports = {
  discordToken: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  guildId: required('DISCORD_GUILD_ID'),

  liveChannelId: required('LIVE_CHANNEL_ID'),
  soldoutChannelId: required('SOLDOUT_CHANNEL_ID'),

  pollIntervalSeconds: parseInt(process.env.POLL_INTERVAL_SECONDS || '45', 10),
  pollMaxPages: parseInt(process.env.POLL_MAX_PAGES || '10', 10),
  minStock: parseInt(process.env.MIN_STOCK || '0', 10),

  catalogCategory: process.env.CATALOG_CATEGORY || '11',
  catalogSubcategory: process.env.CATALOG_SUBCATEGORY || '',

  adminRoleId: process.env.ADMIN_ROLE_ID || null,
};

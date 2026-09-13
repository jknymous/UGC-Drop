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

  // Jalur cepat: selalu cek halaman terbaru doang, sengaja kecil & sering biar ga numpuk.
  hotIntervalSeconds: parseInt(process.env.HOT_INTERVAL_SECONDS || '15', 10),
  hotMaxPages: parseInt(process.env.HOT_MAX_PAGES || '2', 10),

  // Jalur coverage: rotating scan buat mastiin seluruh katalog ke-cover lama-lama.
  pollIntervalSeconds: parseInt(process.env.POLL_INTERVAL_SECONDS || '45', 10),
  pollMaxPages: parseInt(process.env.POLL_MAX_PAGES || '10', 10),

  minStock: parseInt(process.env.MIN_STOCK || '0', 10),

  catalogCategory: process.env.CATALOG_CATEGORY || '11',
  catalogSubcategory: process.env.CATALOG_SUBCATEGORY || '',

  adminRoleId: process.env.ADMIN_ROLE_ID || null,
};

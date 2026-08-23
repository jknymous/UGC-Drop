# UGC Tracker Bot

Bot Discord buat auto-track Free UGC Roblox: nama item, gambar, creator, map/game asal item, dan stock yang tersisa. Item yang masih available diposting/di-update di satu channel (live), begitu stock habis otomatis dipindah ke channel arsip (sold out).

## ⚠️ Penting sebelum dipakai

Kode ini pakai beberapa endpoint publik Roblox (`catalog.roblox.com`, `economy.roblox.com`, `games.roblox.com`, `thumbnails.roblox.com`) yang **tidak resmi didokumentasikan buat kebutuhan ini** dan **bisa berubah struktur responsnya kapan aja** tanpa pemberitahuan dari Roblox. Sebelum production:

1. Jalanin bot di server test dulu, pantau log console-nya.
2. Kalau field `SaleLocation` / `UniorseIds` / `UnitsAvailableForConsumption` di `src/services/robloxApi.js` dan `src/services/poller.js` ternyata beda dari yang diasumsikan kode ini, `console.log(details)` di `enrichItem()` (poller.js) buat liat struktur asli respons-nya, terus sesuaikan parsing-nya.
3. Kalau Roblox mulai nge-block/rate-limit request dari IP VPS lu, naikin `POLL_INTERVAL_MINUTES` dan `sleep()` delay di `poller.js`.
4. Development sandbox yang dipakai buat bikin bot ini nggak bisa akses domain roblox.com langsung, jadi kode ini **belum pernah dites langsung ke API asli**. Test dulu manual sebelum deploy full.

## Setup

### 1. Bikin Discord Application & Bot

1. Buka https://discord.com/developers/applications → New Application
2. Ke tab **Bot** → klik **Reset Token** → copy token-nya (ini `DISCORD_TOKEN`)
3. Aktifkan intent yang dibutuhin (bot ini cuma butuh intent dasar, ga perlu Message Content Intent)
4. Ke tab **OAuth2 > URL Generator** → centang `bot` dan `applications.commands` → scope permission minimal: Send Messages, Embed Links, Manage Messages (buat hapus pesan pas pindah ke sold out) → copy link → invite bot ke server lu
5. `DISCORD_CLIENT_ID` = Application ID (ada di halaman General Information)
6. `DISCORD_GUILD_ID` = ID server Discord lu (aktifkan Developer Mode di Discord Settings > Advanced, terus klik kanan nama server > Copy Server ID)

### 2. Bikin 2 channel

- 1 channel buat live update (misal `#ugc-free-live`) → copy Channel ID → `LIVE_CHANNEL_ID`
- 1 channel buat arsip sold out (misal `#ugc-sold-out`) → copy Channel ID → `SOLDOUT_CHANNEL_ID`

### 3. Konfigurasi

```bash
cp .env.example .env
nano .env   # isi semua value-nya
```

### 4. Install & jalanin

```bash
npm install
npm run deploy-commands   # daftarin slash command ke server (sekali aja, atau tiap nambah command baru)
npm start
```

### 5. Deploy ke VPS pake PM2

```bash
pm2 start src/index.js --name ugc-tracker-bot
pm2 save
```

## Cara kerja

1. Tiap `POLL_INTERVAL_MINUTES` menit, bot search catalog Roblox buat item dengan harga 0 (Free) di kategori yang di-set di `.env`.
2. Setiap item yang ketemu di-fetch detail lengkapnya: creator, quantity remaining, dan `SaleLocation` (kalau ada) buat tau map/game asalnya.
3. Kalau map/game info nggak ketemu otomatis dari API, bot bakal cek tabel manual override dulu (isi lewat `/addmapinfo`).
4. Item baru / masih available → post atau update embed di channel live.
5. Item yang quantity-nya abis → embed dipindah (post baru di channel sold-out, dihapus dari channel live).

## Slash Commands

| Command | Fungsi |
|---|---|
| `/forcecheck` | Paksa jalanin polling sekarang juga (admin only) |
| `/addmapinfo item_id game_name game_url` | Set manual info map/game buat item tertentu (admin only) |
| `/ugcstatus item_id` | Cek status stock item yang lagi di-track |

Admin-only command dibatasin pake `ADMIN_ROLE_ID` di `.env`. Kalau kosong, semua orang bisa pakai (nggak disaranin buat production).

## Struktur project

```
src/
  index.js              # entry point, login bot + jadwal cron polling
  config.js              # load .env
  deploy-commands.js     # register slash command ke Discord
  database/db.js         # setup SQLite + query helper
  services/
    robloxApi.js         # semua request ke API Roblox
    poller.js             # logic utama: search -> enrich -> post/update/pindah channel
    embedBuilder.js       # bikin embed Discord buat item active/soldout
  commands/
    forcecheck.js
    addmapinfo.js
    ugcstatus.js
```

## Kustomisasi lanjut yang mungkin lu butuh

- **Multi-kategori**: sekarang cuma search 1 `Category`/`Subcategory` dari `.env`. Kalau mau cover beberapa kategori sekaligus (Accessories, Hats, dll), ubah `poller.js` buat loop beberapa kombinasi kategori.
- **Notifikasi ping role**: tinggal tambahin `content: '<@&ROLE_ID>'` di `channel.send()` pas post item baru di `poller.js`.
- **Rate limit Roblox**: kalau ke-block, biasanya karena request API dari 1 IP terlalu sering. Naikin delay `sleep()` di `poller.js` atau kurangin `maxPages` per cycle.

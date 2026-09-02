const robloxApi = require('./robloxApi');
const db = require('../database/db');
const { buildActiveEmbed, buildSoldOutEmbed } = require('./embedBuilder');
const config = require('../config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let isRunning = false;

/**
 * Ambil detail lengkap 1 item dari hasil search (economy + thumbnail + game info).
 * Return null kalau gagal fetch (item ke-delist, API error, dll) - biar polling lanjut jalan.
 */
/**
 * Ambil detail lengkap 1 item dari hasil search (thumbnail + game info).
 * Field quantity (unitsAvailableForConsumption, totalQuantity) buat item Limited UGC
 * udah nempel LANGSUNG di response search API (searchResult), jadi kita pake itu duluan.
 * Endpoint economy API cuma dipake buat fallback/pelengkap data non-quantity kalau perlu.
 */
async function enrichItem(searchResult) {
  const itemId = searchResult.id;
  try {
    // Ambil quantity langsung dari hasil search - ini yang paling akurat buat Limited UGC
    let quantityTotal = searchResult.totalQuantity ?? null;
    let quantityRemaining = searchResult.unitsAvailableForConsumption ?? null;
    let priceRobux = searchResult.price ?? 0;
    let creatorName = searchResult.creatorName ?? null;
    let creatorType = searchResult.creatorType ?? null;
    let name = searchResult.name;

    // SaleLocation (buat map/game info) masih perlu manggil economy API terpisah,
    // karena field ini nggak selalu ikut di response search.
    let universeIds = [];
    try {
      const details = await robloxApi.getAssetDetails(itemId);
      universeIds = details?.SaleLocation?.UniverseIds || details?.saleLocation?.universeIds || [];
      // Kalau search result kosong tapi economy API ada datanya, pake sebagai fallback
      if (quantityTotal === null) quantityTotal = details.TotalQuantity ?? details.totalQuantity ?? null;
      if (quantityRemaining === null) quantityRemaining = details.UnitsAvailableForConsumption ?? details.unitsAvailableForConsumption ?? null;
      if (!creatorName) creatorName = details.Creator?.Name;
      if (!creatorType) creatorType = details.Creator?.CreatorType;
    } catch (err) {
      console.warn(`[poller] Economy API gagal buat item ${itemId} (skip SaleLocation): ${err.message}`);
    }

    let gameName = null;
    let gameUrl = null;

    if (universeIds.length > 0) {
      const universeInfo = await robloxApi.getUniverseInfo(universeIds);
      const first = universeInfo[universeIds[0]];
      if (first) {
        gameName = first.name;
        gameUrl = first.url;
      }
    }

    // Fallback: kalau API ga kasih map info, cek manual override dari admin
    if (!gameName) {
      const override = db.getMapOverride(itemId);
      if (override) {
        gameName = override.game_name;
        gameUrl = override.game_url;
      }
    }

    const thumbs = await robloxApi.getThumbnails([itemId]);

    return {
      itemId,
      name,
      creatorName,
      creatorType,
      thumbnailUrl: thumbs[itemId] || null,
      universeId: universeIds[0] || null,
      gameName,
      gameUrl,
      priceRobux,
      quantityTotal,
      quantityRemaining,
    };
  } catch (err) {
    console.error(`[poller] Gagal enrich item ${itemId}:`, err.message);
    return null;
  }
}

async function postOrUpdateLive(client, item) {
  const channel = await client.channels.fetch(config.liveChannelId);
  const existing = db.getItem(item.itemId);
  const embed = buildActiveEmbed(item);

  if (existing && existing.live_message_id) {
    try {
      const msg = await channel.messages.fetch(existing.live_message_id);
      await msg.edit({ embeds: [embed] });
      return;
    } catch (err) {
      console.warn(`[poller] Message lama item ${item.itemId} ga ketemu, kirim baru.`);
    }
  }

  const msg = await channel.send({ embeds: [embed] });
  db.setLiveMessageId(item.itemId, msg.id);
}

async function moveToSoldOut(client, item) {
  const liveChannel = await client.channels.fetch(config.liveChannelId);
  const soldoutChannel = await client.channels.fetch(config.soldoutChannelId);
  const existing = db.getItem(item.itemId);

  // Hapus/hilangin dari live channel
  if (existing?.live_message_id) {
    try {
      const msg = await liveChannel.messages.fetch(existing.live_message_id);
      await msg.delete();
    } catch (err) {
      // pesan mungkin udah kehapus manual, skip aja
    }
  }

  // Post ke soldout channel
  const embed = buildSoldOutEmbed(item);
  const msg = await soldoutChannel.send({ embeds: [embed] });
  db.setSoldoutMessageId(item.itemId, msg.id);
}

async function runPollCycle(client) {
  if (isRunning) {
    console.log('[poller] Cycle sebelumnya masih jalan, skip cycle ini biar ga numpuk.');
    return;
  }
  isRunning = true;
  console.log(`[poller] Mulai polling cycle - ${new Date().toISOString()}`);

  try {
    let cursor = db.getLastCursor(); // lanjut dari posisi terakhir, bukan mulai dari 0
    let totalChecked = 0;
    const maxPages = config.pollMaxPages;
    let reachedEnd = false;

    for (let page = 0; page < maxPages; page++) {
      let searchResult;
      try {
        searchResult = await robloxApi.searchFreeItems({
          category: config.catalogCategory,
          subcategory: config.catalogSubcategory,
          cursor,
        });
      } catch (err) {
        console.error('[poller] Gagal search catalog:', err.message);
        break;
      }

      for (const raw of searchResult.items) {
        totalChecked++;

        // Filter awal pake data mentah dari search result (belum fetch detail apapun) -
        // biar item stock kecil langsung di-skip tanpa buang waktu/API call buat enrich.
        const rawTotalQty = raw.totalQuantity ?? null;
        if (config.minStock > 0 && rawTotalQty !== null && rawTotalQty < config.minStock) {
          continue;
        }

        const enriched = await enrichItem(raw);
        if (!enriched) continue;

        // Skip item dari map yang udah di-blok (misal map spam kayak "Flex UGC Codes")
        if (db.isMapBlocked({ gameName: enriched.gameName, universeId: enriched.universeId })) {
          console.log(`[poller] Skip item ${enriched.itemId} (${enriched.name}) - map di-blok: ${enriched.gameName}`);
          continue;
        }

        // Filter kedua pake data yang udah di-enrich, jaga-jaga kalau raw search result ga ada totalQuantity-nya
        if (config.minStock > 0 && enriched.quantityTotal !== null && enriched.quantityTotal < config.minStock) {
          console.log(`[poller] Skip item ${enriched.itemId} (${enriched.name}) - stock ${enriched.quantityTotal} di bawah MIN_STOCK ${config.minStock}`);
          continue;
        }

        const wasTracked = db.getItem(enriched.itemId);
        const isSoldOut = enriched.quantityTotal !== null && enriched.quantityRemaining === 0;

        const saved = db.upsertItem({
          ...enriched,
          status: isSoldOut ? 'soldout' : 'active',
        });

        if (isSoldOut) {
          // baru sold out sekarang (sebelumnya active / belum pernah diproses ke soldout channel)
          if (!wasTracked || wasTracked.status !== 'soldout') {
            await moveToSoldOut(client, enriched);
          }
        } else {
          await postOrUpdateLive(client, enriched);
        }

        await sleep(250); // jaga-jaga rate limit Roblox API
      }

      if (!searchResult.nextCursor) {
        reachedEnd = true;
        break;
      }
      cursor = searchResult.nextCursor;
    }

    // Simpen posisi buat cycle berikutnya. Kalau abis (nyampe akhir katalog), muter balik ke awal.
    db.setLastCursor(reachedEnd ? '' : cursor);

    console.log(`[poller] Selesai. Total item dicek: ${totalChecked}${reachedEnd ? ' (nyampe akhir katalog, muter balik ke awal cycle berikutnya)' : ''}`);
  } finally {
    isRunning = false;
  }
}

module.exports = { runPollCycle };

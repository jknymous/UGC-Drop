const robloxApi = require('./robloxApi');
const db = require('../database/db');
const { buildActiveEmbed, buildSoldOutEmbed } = require('./embedBuilder');
const config = require('../config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let isRunning = false;

/**
 * Proses 1 halaman hasil search sekaligus (bukan 1 item per 1 item lagi):
 * - Filter awal pake data mentah (MIN_STOCK) SEBELUM manggil API apapun lagi.
 * - Batch call buat detail (1 request buat semua item yang lolos filter).
 * - Batch call buat thumbnail (1 request).
 * - SaleLocation (map/game info): coba dari batch details dulu, kalau ga ada baru fallback
 *   ke economy API PER ITEM - tapi cuma buat item yang udah lolos filter (jauh lebih dikit
 *   daripada 1 halaman penuh), jadi tetep hemat request dibanding sebelumnya.
 * - Universe/game name di-resolve sekali per halaman (batch), bukan per item.
 */
async function enrichPage(rawItems) {
  // 1. Filter awal pake raw data - skip item stock kecil TANPA fetch apapun.
  const candidates = rawItems.filter((raw) => {
    const rawTotalQty = raw.totalQuantity ?? null;
    if (config.minStock > 0 && rawTotalQty !== null && rawTotalQty < config.minStock) return false;
    return true;
  });

  if (!candidates.length) return [];

  const ids = candidates.map((c) => c.id);

  // 2. Batch detail (1 request buat semua item di halaman ini)
  let batchDetailsMap = {};
  try {
    const batch = await robloxApi.getCatalogItemsDetailsBatch(ids);
    for (const d of batch) batchDetailsMap[d.id] = d;
  } catch (err) {
    console.warn('[poller] Batch details gagal, lanjut pake data search doang:', err.message);
  }

  // 3. Batch thumbnail (1 request buat semua item)
  let thumbs = {};
  try {
    thumbs = await robloxApi.getThumbnails(ids);
  } catch (err) {
    console.warn('[poller] Batch thumbnail gagal:', err.message);
  }

  // 4. Susun data dasar tiap item dulu, kumpulin mana yang masih butuh SaleLocation fallback
  const enrichedDraft = [];
  const needsSaleLocationLookup = [];

  for (const raw of candidates) {
    const batchInfo = batchDetailsMap[raw.id] || {};
    const universeIdFromBatch =
      batchInfo?.saleLocation?.universeIds?.[0] ?? batchInfo?.SaleLocation?.UniverseIds?.[0] ?? null;

    const draft = {
      itemId: raw.id,
      name: batchInfo.name || raw.name,
      creatorName: batchInfo.creatorName || raw.creatorName || null,
      creatorType: batchInfo.creatorType || raw.creatorType || null,
      priceRobux: batchInfo.price ?? raw.price ?? 0,
      quantityTotal: raw.totalQuantity ?? batchInfo.totalQuantity ?? null,
      quantityRemaining: raw.unitsAvailableForConsumption ?? batchInfo.unitsAvailableForConsumption ?? null,
      thumbnailUrl: thumbs[raw.id] || null,
      universeId: universeIdFromBatch,
      gameName: null,
      gameUrl: null,
    };

    if (!universeIdFromBatch) {
      needsSaleLocationLookup.push(draft);
    }

    enrichedDraft.push(draft);
  }

  // 5. Fallback SaleLocation PER ITEM cuma buat yang emang ga ketemu dari batch details -
  // biasanya ini sisa kecil doang, bukan seluruh halaman.
  for (const draft of needsSaleLocationLookup) {
    try {
      const details = await robloxApi.getAssetDetails(draft.itemId);
      const universeIds = details?.SaleLocation?.UniverseIds || details?.saleLocation?.universeIds || [];
      if (universeIds.length) draft.universeId = universeIds[0];
      // sekalian ambil quantity dari sini kalau masih kosong
      if (draft.quantityTotal === null) draft.quantityTotal = details.TotalQuantity ?? details.totalQuantity ?? null;
      if (draft.quantityRemaining === null) draft.quantityRemaining = details.UnitsAvailableForConsumption ?? details.unitsAvailableForConsumption ?? null;
      await sleep(80); // tetep jaga rate limit walau ini fallback dikit
    } catch (err) {
      // gagal ambil SaleLocation buat item ini, ga masalah - lanjut aja tanpa map info
    }
  }

  // 6. Resolve semua universeId yang berhasil ketemu jadi nama game - SEKALIGUS (1 request)
  const uniqueUniverseIds = [...new Set(enrichedDraft.filter((d) => d.universeId).map((d) => d.universeId))];
  let universeInfo = {};
  if (uniqueUniverseIds.length) {
    try {
      universeInfo = await robloxApi.getUniverseInfo(uniqueUniverseIds);
    } catch (err) {
      console.warn('[poller] Gagal resolve universe info:', err.message);
    }
  }

  for (const draft of enrichedDraft) {
    if (draft.universeId && universeInfo[draft.universeId]) {
      draft.gameName = universeInfo[draft.universeId].name;
      draft.gameUrl = universeInfo[draft.universeId].url;
    }
    // Fallback terakhir: manual override dari admin (/addmapinfo)
    if (!draft.gameName) {
      const override = db.getMapOverride(draft.itemId);
      if (override) {
        draft.gameName = override.game_name;
        draft.gameUrl = override.game_url;
      }
    }
  }

  return enrichedDraft;
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

  if (existing?.live_message_id) {
    try {
      const msg = await liveChannel.messages.fetch(existing.live_message_id);
      await msg.delete();
    } catch (err) {
      // pesan mungkin udah kehapus manual, skip aja
    }
  }

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
    let cursor = db.getLastCursor();
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

      totalChecked += searchResult.items.length;

      const enrichedItems = await enrichPage(searchResult.items);

      for (const enriched of enrichedItems) {
        if (db.isMapBlocked({ gameName: enriched.gameName, universeId: enriched.universeId })) {
          console.log(`[poller] Skip item ${enriched.itemId} (${enriched.name}) - map di-blok: ${enriched.gameName}`);
          continue;
        }

        const wasTracked = db.getItem(enriched.itemId);
        const isSoldOut = enriched.quantityTotal !== null && enriched.quantityRemaining === 0;

        db.upsertItem({ ...enriched, status: isSoldOut ? 'soldout' : 'active' });

        if (isSoldOut) {
          if (!wasTracked || wasTracked.status !== 'soldout') {
            await moveToSoldOut(client, enriched);
          }
        } else {
          await postOrUpdateLive(client, enriched);
        }
      }

      if (!searchResult.nextCursor) {
        reachedEnd = true;
        break;
      }
      cursor = searchResult.nextCursor;
    }

    db.setLastCursor(reachedEnd ? '' : cursor);

    console.log(`[poller] Selesai. Total item dicek: ${totalChecked}${reachedEnd ? ' (nyampe akhir katalog, muter balik ke awal cycle berikutnya)' : ''}`);
  } finally {
    isRunning = false;
  }
}

module.exports = { runPollCycle };

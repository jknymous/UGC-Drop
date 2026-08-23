const robloxApi = require('./robloxApi');
const db = require('../database/db');
const { buildActiveEmbed, buildSoldOutEmbed } = require('./embedBuilder');
const config = require('../config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ambil detail lengkap 1 item dari hasil search (economy + thumbnail + game info).
 * Return null kalau gagal fetch (item ke-delist, API error, dll) - biar polling lanjut jalan.
 */
async function enrichItem(searchResult) {
  const itemId = searchResult.id;
  try {
    const details = await robloxApi.getAssetDetails(itemId);

    // SaleLocation biasanya berupa { saleLocationType, universeIds: [...] }
    // strukturnya bisa beda tergantung versi API - sesuaikan kalau perlu setelah dites.
    const universeIds = details?.SaleLocation?.UniverseIds || details?.saleLocation?.universeIds || [];
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

    const quantityTotal = details.UnitsAvailableForConsumption ?? details.Sales?.Total ?? null;
    const quantityRemaining = details.UnitsAvailableForConsumption ?? null;

    return {
      itemId,
      name: details.Name || searchResult.name,
      creatorName: details.Creator?.Name || searchResult.creatorName,
      creatorType: details.Creator?.CreatorType || searchResult.creatorType,
      thumbnailUrl: thumbs[itemId] || null,
      universeId: universeIds[0] || null,
      gameName,
      gameUrl,
      priceRobux: details.PriceInRobux ?? 0,
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
  console.log(`[poller] Mulai polling cycle - ${new Date().toISOString()}`);
  let cursor = '';
  let totalChecked = 0;
  const maxPages = 5; // batasin jumlah page per cycle biar ga kena rate limit / kelamaan

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
      const enriched = await enrichItem(raw);
      if (!enriched) continue;

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

      await sleep(300); // jaga-jaga rate limit Roblox API
    }

    if (!searchResult.nextCursor) break;
    cursor = searchResult.nextCursor;
  }

  console.log(`[poller] Selesai. Total item dicek: ${totalChecked}`);
}

module.exports = { runPollCycle };

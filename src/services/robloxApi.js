const axios = require('axios');

const catalogClient = axios.create({ baseURL: 'https://catalog.roblox.com', timeout: 15000 });
const economyClient = axios.create({ baseURL: 'https://economy.roblox.com', timeout: 15000 });
const thumbnailsClient = axios.create({ baseURL: 'https://thumbnails.roblox.com', timeout: 15000 });
const gamesClient = axios.create({ baseURL: 'https://games.roblox.com', timeout: 15000 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Roblox mewajibkan CSRF token buat request POST/PUT/DELETE. Token ini didapet dari
// header response `x-csrf-token` begitu kita kena 403 pertama kali - lalu dipake buat semua
// request POST berikutnya. Disimpen di module-level biar reusable antar request.
let csrfToken = null;

/**
 * Attach interceptor: (1) sisipin CSRF token ke tiap request kalau udah ada,
 * (2) kalau kena 403 dan responsnya bawa token baru, simpen & retry sekali,
 * (3) kalau kena 429 (rate limited), retry pake backoff (max 3x).
 */
function attachInterceptors(client) {
  client.interceptors.request.use((cfg) => {
    if (csrfToken) {
      cfg.headers = { ...cfg.headers, 'x-csrf-token': csrfToken };
    }
    return cfg;
  });

  client.interceptors.response.use(
    (res) => res,
    async (error) => {
      const cfg = error.config;
      if (!cfg || !error.response) return Promise.reject(error);

      cfg.__retryCount = cfg.__retryCount || 0;
      cfg.__csrfRetried = cfg.__csrfRetried || false;

      // Kasus 1: butuh CSRF token (khusus request POST/PUT/DELETE ke Roblox)
      const newCsrfToken = error.response.headers['x-csrf-token'];
      if (error.response.status === 403 && newCsrfToken && !cfg.__csrfRetried) {
        csrfToken = newCsrfToken;
        cfg.__csrfRetried = true;
        cfg.headers = { ...cfg.headers, 'x-csrf-token': csrfToken };
        console.warn('[robloxApi] Dapet CSRF token baru, retry request sekali...');
        return client(cfg);
      }

      // Kasus 2: kena rate limit
      if (error.response.status === 429 && cfg.__retryCount < 3) {
        cfg.__retryCount += 1;
        const retryAfterHeader = error.response.headers['retry-after'];
        const waitMs = retryAfterHeader
          ? parseFloat(retryAfterHeader) * 1000
          : 1000 * Math.pow(2, cfg.__retryCount); // 2s, 4s, 8s
        console.warn(`[robloxApi] Kena rate limit (429), retry ke-${cfg.__retryCount} setelah ${waitMs}ms...`);
        await sleep(waitMs);
        return client(cfg);
      }

      return Promise.reject(error);
    }
  );
}

[catalogClient, economyClient, thumbnailsClient, gamesClient].forEach(attachInterceptors);

/**
 * Search catalog buat item Free (price 0) di kategori tertentu.
 */
async function searchFreeItems({ category = '11', subcategory = '', cursor = '', bypassCache = false } = {}) {
  const params = {
    Category: category,
    MinPrice: 0,
    MaxPrice: 0,
    SortType: 3, // Recently Updated
    Limit: 30,
  };
  if (subcategory) params.Subcategory = subcategory;
  if (cursor) params.Cursor = cursor;
  // Cache-busting: nambahin param random/timestamp biar CDN/edge cache Roblox ga ngasih
  // response basi yang sama berulang-ulang. TRADE-OFF: ini bikin request kita selalu
  // nembak origin server asli (bukan cache), jadi risiko kena 429 naik lagi.
  if (bypassCache) params._cb = Date.now();

  const { data } = await catalogClient.get('/v1/search/items/details', { params });
  return {
    items: data.data || [],
    nextCursor: data.nextPageCursor || null,
  };
}

/**
 * Ambil detail BANYAK item sekaligus dalam 1 request (endpoint batch resmi Roblox, POST -
 * makanya butuh CSRF token, udah di-handle otomatis sama interceptor di atas).
 */
async function getCatalogItemsDetailsBatch(itemIds = []) {
  if (!itemIds.length) return [];
  const { data } = await catalogClient.post('/v1/catalog/items/details', {
    items: itemIds.map((id) => ({ itemType: 1, id })), // itemType 1 = Asset
  });
  return data.data || [];
}

/**
 * Ambil detail lengkap 1 item (termasuk SaleLocation/map info) - fallback per-item
 * cuma buat item yang lolos filter dan ga ketemu SaleLocation-nya dari batch.
 */
async function getAssetDetails(assetId) {
  const { data } = await economyClient.get(`/v2/assets/${assetId}/details`);
  return data;
}

/**
 * Ambil nama & root place dari satu atau lebih universeId sekaligus.
 */
async function getUniverseInfo(universeIds = []) {
  if (!universeIds.length) return {};
  const { data } = await gamesClient.get('/v1/games', {
    params: { universeIds: universeIds.join(',') },
  });
  const map = {};
  for (const game of data.data || []) {
    map[game.id] = {
      name: game.name,
      rootPlaceId: game.rootPlaceId,
      url: `https://www.roblox.com/games/${game.rootPlaceId}`,
    };
  }
  return map;
}

/**
 * Ambil thumbnail image URL buat BANYAK item sekaligus dalam 1 request.
 */
async function getThumbnails(assetIds = [], size = '420x420') {
  if (!assetIds.length) return {};
  const { data } = await thumbnailsClient.get('/v1/assets', {
    params: {
      assetIds: assetIds.join(','),
      size,
      format: 'Png',
      isCircular: false,
    },
  });
  const map = {};
  for (const thumb of data.data || []) {
    map[thumb.targetId] = thumb.imageUrl;
  }
  return map;
}

module.exports = {
  searchFreeItems,
  getCatalogItemsDetailsBatch,
  getAssetDetails,
  getUniverseInfo,
  getThumbnails,
};

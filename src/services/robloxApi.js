const axios = require('axios');

const catalogClient = axios.create({ baseURL: 'https://catalog.roblox.com', timeout: 15000 });
const economyClient = axios.create({ baseURL: 'https://economy.roblox.com', timeout: 15000 });
const thumbnailsClient = axios.create({ baseURL: 'https://thumbnails.roblox.com', timeout: 15000 });
const gamesClient = axios.create({ baseURL: 'https://games.roblox.com', timeout: 15000 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Attach retry-with-backoff interceptor buat semua client - kalau kena 429 (rate limited),
 * tunggu sesuai header Retry-After (atau exponential backoff kalau ga ada header itu), lalu retry.
 * Max 3x retry per request biar ga infinite loop kalau Roblox lagi down beneran.
 */
function attachRetry(client) {
  client.interceptors.response.use(
    (res) => res,
    async (error) => {
      const cfg = error.config;
      if (!cfg) return Promise.reject(error);
      cfg.__retryCount = cfg.__retryCount || 0;

      const isRateLimited = error.response && error.response.status === 429;
      if (isRateLimited && cfg.__retryCount < 3) {
        cfg.__retryCount += 1;
        const retryAfterHeader = error.response.headers['retry-after'];
        const waitMs = retryAfterHeader
          ? parseFloat(retryAfterHeader) * 1000
          : 1000 * Math.pow(2, cfg.__retryCount); // exponential backoff: 2s, 4s, 8s
        console.warn(`[robloxApi] Kena rate limit (429), retry ke-${cfg.__retryCount} setelah ${waitMs}ms...`);
        await sleep(waitMs);
        return client(cfg);
      }
      return Promise.reject(error);
    }
  );
}

[catalogClient, economyClient, thumbnailsClient, gamesClient].forEach(attachRetry);

/**
 * Search catalog buat item Free (price 0) di kategori tertentu.
 */
async function searchFreeItems({ category = '11', subcategory = '', cursor = '' } = {}) {
  const params = {
    Category: category,
    MinPrice: 0,
    MaxPrice: 0,
    SortType: 3, // Recently Updated
    Limit: 30,
  };
  if (subcategory) params.Subcategory = subcategory;
  if (cursor) params.Cursor = cursor;

  const { data } = await catalogClient.get('/v1/search/items/details', { params });
  return {
    items: data.data || [],
    nextCursor: data.nextPageCursor || null,
  };
}

/**
 * Ambil detail BANYAK item sekaligus dalam 1 request (endpoint batch resmi Roblox).
 * Jauh lebih efisien daripada manggil getAssetDetails() satu-satu per item -
 * ini kunci biar bot bisa cepet tanpa nembak API kebanyakan kali dan kena rate limit.
 */
async function getCatalogItemsDetailsBatch(itemIds = []) {
  if (!itemIds.length) return [];
  const { data } = await catalogClient.post('/v1/catalog/items/details', {
    items: itemIds.map((id) => ({ itemType: 1, id })), // itemType 1 = Asset
  });
  return data.data || [];
}

/**
 * Ambil detail lengkap 1 item (termasuk SaleLocation/map info) - dipake sebagai FALLBACK
 * per-item cuma buat item yang lolos filter (jumlahnya jauh lebih sedikit daripada 1 halaman penuh),
 * karena endpoint batch di atas biasanya ga selalu include SaleLocation.
 */
async function getAssetDetails(assetId) {
  const { data } = await economyClient.get(`/v2/assets/${assetId}/details`);
  return data;
}

/**
 * Ambil nama & root place (buat link "PLAY NOW") dari satu atau lebih universeId sekaligus.
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

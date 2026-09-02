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
      const config = error.config;
      if (!config) return Promise.reject(error);
      config.__retryCount = config.__retryCount || 0;

      const isRateLimited = error.response && error.response.status === 429;
      if (isRateLimited && config.__retryCount < 3) {
        config.__retryCount += 1;
        const retryAfterHeader = error.response.headers['retry-after'];
        const waitMs = retryAfterHeader
          ? parseFloat(retryAfterHeader) * 1000
          : 1000 * Math.pow(2, config.__retryCount); // exponential backoff: 2s, 4s, 8s
        console.warn(`[robloxApi] Kena rate limit (429), retry ke-${config.__retryCount} setelah ${waitMs}ms...`);
        await sleep(waitMs);
        return client(config);
      }
      return Promise.reject(error);
    }
  );
}

[catalogClient, economyClient, thumbnailsClient, gamesClient].forEach(attachRetry);

/**
 * Search catalog buat item Free (price 0) di kategori tertentu.
 * Docs resmi: https://create.roblox.com/docs/projects/assets/api
 * Endpoint ini yang dipake situs roblox.com/catalog sendiri.
 */
async function searchFreeItems({ category = '11', subcategory = '', cursor = '' } = {}) {
  const params = {
    Category: category,
    MinPrice: 0,
    MaxPrice: 0,
    SortType: 3, // Recently Updated - biar item baru nongol duluan
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
 * Ambil detail lengkap 1 item (harga, quantity, sale location) via economy API.
 * NOTE: endpoint ini legacy tapi masih dipakai luas oleh komunitas dev Roblox
 * buat ambil field kayak SaleLocation & unitsAvailableForConsumption.
 * Kalau Roblox ubah struktur response-nya, sesuaikan parsing di bawah -
 * lu bisa cek response mentah dulu via console.log sebelum production.
 */
async function getAssetDetails(assetId) {
  const { data } = await economyClient.get(`/v2/assets/${assetId}/details`);
  return data;
}

/**
 * Ambil nama & root place (buat link "PLAY NOW") dari satu atau lebih universeId.
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
 * Ambil thumbnail image URL buat satu atau lebih item ID.
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
  getAssetDetails,
  getUniverseInfo,
  getThumbnails,
};

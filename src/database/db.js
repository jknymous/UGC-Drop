const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', '..', 'data.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS items (
  item_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  creator_name TEXT,
  creator_type TEXT,
  thumbnail_url TEXT,
  universe_id INTEGER,
  game_name TEXT,
  game_url TEXT,
  price_robux INTEGER DEFAULT 0,
  quantity_total INTEGER,
  quantity_remaining INTEGER,
  status TEXT DEFAULT 'active',        -- 'active' | 'soldout'
  live_message_id TEXT,
  soldout_message_id TEXT,
  first_seen_at TEXT DEFAULT (datetime('now')),
  last_updated_at TEXT DEFAULT (datetime('now'))
);

-- Manual override buat map/game info kalau SaleLocation ga ada di API
CREATE TABLE IF NOT EXISTS map_overrides (
  item_id INTEGER PRIMARY KEY,
  game_name TEXT,
  game_url TEXT,
  set_by TEXT,
  set_at TEXT DEFAULT (datetime('now'))
);

-- Daftar map/game yang item-nya mau di-skip (ga usah diposting sama sekali)
CREATE TABLE IF NOT EXISTS blocked_maps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_name_pattern TEXT NOT NULL,  -- dicocokin case-insensitive, partial match
  universe_id INTEGER,               -- opsional, kalau mau blok berdasarkan universe id persis
  blocked_by TEXT,
  blocked_at TEXT DEFAULT (datetime('now'))
);
`);

module.exports = {
  db,

  getItem(itemId) {
    return db.prepare('SELECT * FROM items WHERE item_id = ?').get(itemId);
  },

  upsertItem(item) {
    const existing = module.exports.getItem(item.itemId);
    if (existing) {
      db.prepare(`
        UPDATE items SET
          name = ?, creator_name = ?, creator_type = ?, thumbnail_url = ?,
          universe_id = ?, game_name = ?, game_url = ?, price_robux = ?,
          quantity_total = ?, quantity_remaining = ?, status = ?,
          last_updated_at = datetime('now')
        WHERE item_id = ?
      `).run(
        item.name, item.creatorName, item.creatorType, item.thumbnailUrl,
        item.universeId, item.gameName, item.gameUrl, item.priceRobux,
        item.quantityTotal, item.quantityRemaining, item.status,
        item.itemId
      );
    } else {
      db.prepare(`
        INSERT INTO items (
          item_id, name, creator_name, creator_type, thumbnail_url,
          universe_id, game_name, game_url, price_robux,
          quantity_total, quantity_remaining, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        item.itemId, item.name, item.creatorName, item.creatorType, item.thumbnailUrl,
        item.universeId, item.gameName, item.gameUrl, item.priceRobux,
        item.quantityTotal, item.quantityRemaining, item.status || 'active'
      );
    }
    return module.exports.getItem(item.itemId);
  },

  setLiveMessageId(itemId, messageId) {
    db.prepare('UPDATE items SET live_message_id = ? WHERE item_id = ?').run(messageId, itemId);
  },

  setSoldoutMessageId(itemId, messageId) {
    db.prepare('UPDATE items SET soldout_message_id = ? WHERE item_id = ?').run(messageId, itemId);
  },

  markSoldOut(itemId) {
    db.prepare(`UPDATE items SET status = 'soldout', quantity_remaining = 0, last_updated_at = datetime('now') WHERE item_id = ?`).run(itemId);
  },

  getActiveItems() {
    return db.prepare(`SELECT * FROM items WHERE status = 'active'`).all();
  },

  getMapOverride(itemId) {
    return db.prepare('SELECT * FROM map_overrides WHERE item_id = ?').get(itemId);
  },

  setMapOverride(itemId, gameName, gameUrl, setBy) {
    db.prepare(`
      INSERT INTO map_overrides (item_id, game_name, game_url, set_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        game_name = excluded.game_name,
        game_url = excluded.game_url,
        set_by = excluded.set_by,
        set_at = datetime('now')
    `).run(itemId, gameName, gameUrl, setBy);
  },

  addBlockedMap(gameNamePattern, universeId, blockedBy) {
    db.prepare(`
      INSERT INTO blocked_maps (game_name_pattern, universe_id, blocked_by)
      VALUES (?, ?, ?)
    `).run(gameNamePattern, universeId || null, blockedBy);
  },

  removeBlockedMap(id) {
    db.prepare('DELETE FROM blocked_maps WHERE id = ?').run(id);
  },

  getBlockedMaps() {
    return db.prepare('SELECT * FROM blocked_maps ORDER BY id').all();
  },

  /**
   * Cek apakah sebuah item (berdasarkan game name / universe id) masuk daftar blokir.
   */
  isMapBlocked({ gameName, universeId }) {
    const blocked = module.exports.getBlockedMaps();
    return blocked.some((b) => {
      if (b.universe_id && universeId && Number(b.universe_id) === Number(universeId)) return true;
      if (b.game_name_pattern && gameName) {
        return gameName.toLowerCase().includes(b.game_name_pattern.toLowerCase());
      }
      return false;
    });
  },
};

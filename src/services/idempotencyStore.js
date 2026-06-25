const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export class IdempotencyStore {
  constructor({ database, ttlMs = DEFAULT_TTL_MS } = {}) {
    if (!database?.db) throw new TypeError("SQLite database is required");
    this.database = database;
    this.ttlMs = ttlMs;
  }

  get({ shopId, key, kind }) {
    if (!shopId || !key || !kind) return null;
    this.#deleteExpired();
    const row = this.database.db
      .prepare(
        "SELECT response_json FROM idempotency_keys WHERE shop_id = ? AND key = ? AND kind = ?"
      )
      .get(String(shopId), String(key), String(kind));
    return row ? JSON.parse(row.response_json) : null;
  }

  set({ shopId, key, kind, response }) {
    if (!shopId || !key || !kind) return null;
    const safeResponse = JSON.stringify(response ?? {});
    this.database.db
      .prepare(
        `INSERT OR IGNORE INTO idempotency_keys
          (shop_id, key, kind, response_json, created_at)
          VALUES (?, ?, ?, ?, ?)`
      )
      .run(String(shopId), String(key), String(kind), safeResponse, Date.now());
    return this.get({ shopId, key, kind });
  }

  #deleteExpired() {
    this.database.db
      .prepare("DELETE FROM idempotency_keys WHERE created_at < ?")
      .run(Date.now() - this.ttlMs);
  }
}

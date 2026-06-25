import { randomUUID } from "node:crypto";

const DEFAULT_STATE_TTL_MS = 5 * 60 * 1000;

export class OAuthStateStore {
  constructor({ idempotencyStore, ttlMs = DEFAULT_STATE_TTL_MS } = {}) {
    if (!idempotencyStore) throw new TypeError("idempotencyStore is required");
    this.idempotencyStore = idempotencyStore;
    this.ttlMs = ttlMs;
  }

  create({ shopId, platform }) {
    const state = randomUUID();
    this.idempotencyStore.reserve(this.#key({ shopId, platform, state }), this.ttlMs);
    return state;
  }

  consume({ shopId, platform, state }) {
    if (!state) return false;
    const key = this.#key({ shopId, platform, state });
    if (!this.idempotencyStore.has(key)) return false;
    this.idempotencyStore.release(key);
    return true;
  }

  #key({ shopId, platform, state }) {
    return `oauth:${shopId}:${platform}:${state}`;
  }
}

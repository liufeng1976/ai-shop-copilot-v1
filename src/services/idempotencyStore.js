import { createHash } from "node:crypto";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function hashKey(key) {
  return createHash("sha256").update(String(key)).digest("hex");
}

export class IdempotencyStore {
  #items = new Map();

  constructor({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  has(key) {
    this.#deleteExpired();
    return this.#items.has(hashKey(key));
  }

  reserve(key, ttl = this.ttlMs) {
    this.#deleteExpired();
    const keyHash = hashKey(key);
    if (this.#items.has(keyHash)) return false;
    this.#items.set(keyHash, {
      keyHash,
      status: "RESERVED",
      expiresAt: this.now() + ttl
    });
    return true;
  }

  complete(key) {
    const item = this.#items.get(hashKey(key));
    if (!item) return false;
    item.status = "COMPLETE";
    return true;
  }

  release(key) {
    return this.#items.delete(hashKey(key));
  }

  getStatus(key) {
    this.#deleteExpired();
    return this.#items.get(hashKey(key))?.status ?? null;
  }

  snapshot() {
    this.#deleteExpired();
    return [...this.#items.values()].map((item) => ({ ...item }));
  }

  #deleteExpired() {
    const now = this.now();
    for (const [keyHash, item] of this.#items.entries()) {
      if (item.expiresAt <= now) this.#items.delete(keyHash);
    }
  }
}

export { hashKey };

import { randomUUID } from "node:crypto";

const VALID_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED"]);

export class ReviewQueue {
  #items = new Map();

  enqueue({ requestId, shopId, reply, confidence, knowledgeRefs }) {
    const item = {
      id: randomUUID(),
      requestId: String(requestId),
      shopId: String(shopId),
      status: "PENDING",
      reply: String(reply),
      confidence: Number(confidence),
      knowledgeRefs: knowledgeRefs.map(String),
      createdAt: new Date().toISOString(),
      reviewedAt: null
    };
    this.#items.set(item.id, item);
    return structuredClone(item);
  }

  list({ shopId, status } = {}) {
    if (status && !VALID_STATUSES.has(status)) {
      throw new TypeError("Invalid review status");
    }
    return [...this.#items.values()]
      .filter((item) => !shopId || item.shopId === String(shopId))
      .filter((item) => !status || item.status === status)
      .map((item) => structuredClone(item));
  }

  get(id) {
    const item = this.#items.get(id);
    return item ? structuredClone(item) : null;
  }

  approve(id) {
    return this.#transition(id, "APPROVED");
  }

  reject(id) {
    return this.#transition(id, "REJECTED");
  }

  #transition(id, status) {
    const item = this.#items.get(id);
    if (!item) return null;
    if (item.status !== "PENDING") {
      throw new TypeError("Only pending reviews can be changed");
    }
    item.status = status;
    item.reviewedAt = new Date().toISOString();
    return structuredClone(item);
  }
}

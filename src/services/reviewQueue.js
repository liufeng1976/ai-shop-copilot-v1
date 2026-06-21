import { randomUUID } from "node:crypto";
import { isReviewSafeResult } from "./contentSafety.js";

const VALID_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED"]);

export class ReviewQueue {
  #items = new Map();

  enqueue(input = {}) {
    const forbiddenFields = [
      "buyerMessage",
      "buyer_message",
      "rawContext",
      "raw_context",
      "vectorContext",
      "vector_context",
      "llmPrompt",
      "llm_prompt"
    ];
    if (forbiddenFields.some((field) => Object.hasOwn(input, field))) {
      throw new TypeError("Sensitive context is forbidden in review queue");
    }
    if (!isReviewSafeResult(input.reviewSafety)) {
      throw new TypeError("Verified review-safe reply is required");
    }

    const item = {
      id: randomUUID(),
      shop_id: String(input.shopId),
      request_id: String(input.requestId),
      ai_reply: input.reviewSafety.reply,
      confidence: Number(input.confidence),
      status: "PENDING"
    };
    this.#items.set(item.id, item);
    return structuredClone(item);
  }

  list({ shopId, status } = {}) {
    if (status && !VALID_STATUSES.has(status)) {
      throw new TypeError("Invalid review status");
    }
    return [...this.#items.values()]
      .filter((item) => !shopId || item.shop_id === String(shopId))
      .filter((item) => !status || item.status === status)
      .map((item) => structuredClone(item));
  }

  approve(shopId, id) {
    return this.#transition(shopId, id, "APPROVED");
  }

  reject(shopId, id) {
    return this.#transition(shopId, id, "REJECTED");
  }

  #transition(shopId, id, status) {
    const item = this.#items.get(id);
    if (!item || item.shop_id !== String(shopId)) return null;
    if (item.status !== "PENDING") {
      throw new TypeError("Only pending reviews can be changed");
    }
    item.status = status;
    return structuredClone(item);
  }
}

import { randomUUID } from "node:crypto";
import { isReviewSafeResult } from "./contentSafety.js";
import { SqliteDatabase } from "./database.js";

const VALID_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED"]);

function publicReview(item) {
  return structuredClone({
    id: item.id,
    shop_id: item.shop_id,
    request_id: item.request_id,
    ai_reply: item.ai_reply,
    confidence: item.confidence,
    status: item.status
  });
}

export class ReviewQueue {
  constructor({ database = new SqliteDatabase() } = {}) {
    this.database = database;
  }

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
      status: "PENDING",
      created_at: new Date().toISOString()
    };
    this.database.db
      .prepare(
        `INSERT INTO review_queue
          (id, shop_id, request_id, ai_reply, confidence, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.shop_id,
        item.request_id,
        item.ai_reply,
        item.confidence,
        item.status,
        item.created_at
      );
    return publicReview(item);
  }

  list({ shopId, status } = {}) {
    if (status && !VALID_STATUSES.has(status)) {
      throw new TypeError("Invalid review status");
    }
    const clauses = [];
    const values = [];
    if (shopId) {
      clauses.push("shop_id = ?");
      values.push(String(shopId));
    }
    if (status) {
      clauses.push("status = ?");
      values.push(String(status));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.database.db
      .prepare(`SELECT * FROM review_queue ${where} ORDER BY created_at ASC`)
      .all(...values)
      .map(publicReview);
  }

  get(shopId, id) {
    const item = this.database.db
      .prepare("SELECT * FROM review_queue WHERE id = ? AND shop_id = ?")
      .get(String(id), String(shopId));
    return item ? publicReview(item) : null;
  }

  approve(shopId, id) {
    return this.#transition(shopId, id, "APPROVED");
  }

  reject(shopId, id) {
    return this.#transition(shopId, id, "REJECTED");
  }

  #transition(shopId, id, status) {
    const item = this.database.db
      .prepare("SELECT * FROM review_queue WHERE id = ? AND shop_id = ?")
      .get(String(id), String(shopId));
    if (!item) return null;
    if (item.status !== "PENDING") {
      throw new TypeError("Only pending reviews can be changed");
    }
    this.database.db
      .prepare("UPDATE review_queue SET status = ? WHERE id = ? AND shop_id = ?")
      .run(status, String(id), String(shopId));
    item.status = status;
    return publicReview(item);
  }
}

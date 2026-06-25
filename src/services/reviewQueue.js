import { randomUUID } from "node:crypto";
import { isReviewSafeResult } from "./contentSafety.js";
import { SqliteDatabase } from "./database.js";
import { COMMERCE_INTENTS } from "./commerceIntentClassifier.js";

const VALID_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED"]);
const VALID_PRIORITIES = new Set(["HIGH", "MEDIUM", "LOW"]);
const SUMMARY_INTENTS = Object.freeze(Object.values(COMMERCE_INTENTS));

const HIGH_PRIORITY_INTENTS = new Set([
  COMMERCE_INTENTS.COMPLAINT_RISK,
  COMMERCE_INTENTS.FORBIDDEN_ACTION,
  COMMERCE_INTENTS.ORDER_SENSITIVE
]);

const MEDIUM_PRIORITY_INTENTS = new Set([
  COMMERCE_INTENTS.LOGISTICS,
  COMMERCE_INTENTS.AFTER_SALE
]);

const REVIEW_NOTES = Object.freeze({
  [COMMERCE_INTENTS.FORBIDDEN_ACTION]: "禁止承诺 / 必须人工核实",
  [COMMERCE_INTENTS.COMPLAINT_RISK]: "投诉/差评风险 / 优先处理",
  [COMMERCE_INTENTS.ORDER_SENSITIVE]: "订单/支付/地址/手机号敏感信息 / 人工核实"
});

export function priorityForIntent(intent) {
  if (HIGH_PRIORITY_INTENTS.has(intent)) return "HIGH";
  if (MEDIUM_PRIORITY_INTENTS.has(intent)) return "MEDIUM";
  return "LOW";
}

function publicReview(item) {
  const intent = item.intent ?? COMMERCE_INTENTS.UNKNOWN;
  const priority = VALID_PRIORITIES.has(item.priority) ? item.priority : priorityForIntent(intent);
  return structuredClone({
    id: item.id,
    shop_id: item.shop_id,
    request_id: item.request_id,
    ai_reply: item.ai_reply,
    confidence: item.confidence,
    intent,
    risk_level: item.risk_level ?? "LOW",
    priority,
    review_note: REVIEW_NOTES[intent] ?? null,
    status: item.status,
    created_at: item.created_at
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

    const intent = String(input.intent ?? COMMERCE_INTENTS.UNKNOWN);
    const riskLevel = String(input.riskLevel ?? input.risk_level ?? "LOW");
    const priority = priorityForIntent(intent);
    const item = {
      id: randomUUID(),
      shop_id: String(input.shopId),
      request_id: String(input.requestId),
      ai_reply: input.reviewSafety.reply,
      confidence: Number(input.confidence),
      intent,
      risk_level: riskLevel,
      priority,
      status: "PENDING",
      created_at: new Date().toISOString()
    };
    this.database.db
      .prepare(
        `INSERT INTO review_queue
          (id, shop_id, request_id, ai_reply, confidence, intent, risk_level, priority, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.shop_id,
        item.request_id,
        item.ai_reply,
        item.confidence,
        item.intent,
        item.risk_level,
        item.priority,
        item.status,
        item.created_at
      );
    return publicReview(item);
  }

  list({ shopId, status, priority } = {}) {
    if (status && !VALID_STATUSES.has(status)) {
      throw new TypeError("Invalid review status");
    }
    if (priority && !VALID_PRIORITIES.has(priority)) {
      throw new TypeError("Invalid review priority");
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
    if (priority) {
      clauses.push("priority = ?");
      values.push(String(priority));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.database.db
      .prepare(
        `SELECT * FROM review_queue ${where}
         ORDER BY
           CASE priority
             WHEN 'HIGH' THEN 1
             WHEN 'MEDIUM' THEN 2
             ELSE 3
           END ASC,
           created_at ASC`
      )
      .all(...values)
      .map(publicReview);
  }

  summary({ shopId } = {}) {
    const pending = this.list({ shopId, status: "PENDING" });
    const byIntent = Object.fromEntries(SUMMARY_INTENTS.map((intent) => [intent, 0]));
    const counts = {
      total_pending: pending.length,
      high_priority_pending: 0,
      medium_priority_pending: 0,
      low_priority_pending: 0,
      pending_by_intent: byIntent
    };
    for (const item of pending) {
      if (item.priority === "HIGH") counts.high_priority_pending += 1;
      else if (item.priority === "MEDIUM") counts.medium_priority_pending += 1;
      else counts.low_priority_pending += 1;
      counts.pending_by_intent[item.intent] = (counts.pending_by_intent[item.intent] ?? 0) + 1;
    }
    return structuredClone(counts);
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

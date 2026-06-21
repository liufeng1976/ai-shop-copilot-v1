import { randomUUID } from "node:crypto";
import {
  HUMAN_HANDOFF_REPLY,
  PolicyClassifier
} from "./policyClassifier.js";

const DEFAULT_SHOP_CONFIG = Object.freeze({
  reviewMode: "HYBRID",
  threshold: 0.9
});

function sanitizeDraft(reply) {
  return String(reply)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g, "[REDACTED_PHONE]")
    .replace(
      /\b(?:order|订单|单号)\s*(?:id|号|编号)?\s*[:：#-]?\s*[A-Z0-9-]{5,}\b/gi,
      "[REDACTED_ORDER]"
    );
}

export class ChatService {
  constructor({
    vectorStore,
    provider,
    reviewQueue,
    auditLogger,
    policyClassifier = new PolicyClassifier(),
    shopConfigs = {
      "demo-shop": { reviewMode: "MANUAL", threshold: 0.9 }
    }
  }) {
    this.vectorStore = vectorStore;
    this.provider = provider;
    this.reviewQueue = reviewQueue;
    this.auditLogger = auditLogger;
    this.policyClassifier = policyClassifier;
    this.shopConfigs = shopConfigs;
  }

  async preview({ shopId, buyerMessage, requestId = randomUUID() }) {
    const startedAt = Date.now();
    let tokenUsage = {};
    let status = "FAILED";
    let errorCode;

    try {
      const policy = await this.policyClassifier.classify(buyerMessage);
      if (policy.highRisk) {
        status = "NEEDS_HUMAN";
        errorCode = `POLICY_${policy.code}`;
        return {
          requestId,
          status,
          reply: HUMAN_HANDOFF_REPLY,
          confidence: 0,
          knowledgeHit: false
        };
      }

      const knowledge = this.vectorStore.search(shopId, buyerMessage, 3);
      const result = await this.provider.generate({ buyerMessage, knowledge });
      tokenUsage = result.tokenUsage;
      errorCode = result.errorCode ?? undefined;
      const safeReply = sanitizeDraft(result.reply);
      const replyPolicy = this.policyClassifier.inspectReply(safeReply);

      if (result.needsHuman || !replyPolicy.safe) {
        status = "NEEDS_HUMAN";
        errorCode = replyPolicy.code ?? errorCode;
        return {
          requestId,
          status,
          reply: HUMAN_HANDOFF_REPLY,
          confidence: 0,
          knowledgeHit: knowledge.length > 0
        };
      }

      status = this.#route(shopId, result.confidence);
      if (status === "PENDING_REVIEW") {
        this.reviewQueue.enqueue({
          requestId,
          shopId,
          reply: safeReply,
          confidence: result.confidence,
          knowledgeRefs: knowledge.map(({ id }) => id)
        });
      }

      return {
        requestId,
        status,
        reply: safeReply,
        confidence: result.confidence,
        knowledgeHit: knowledge.length > 0
      };
    } catch {
      status = "NEEDS_HUMAN";
      errorCode = "CHAT_SERVICE_FAILURE";
      return {
        requestId,
        status,
        reply: HUMAN_HANDOFF_REPLY,
        confidence: 0,
        knowledgeHit: false
      };
    } finally {
      this.auditLogger.record({
        requestId,
        shopId,
        action: "CHAT_PREVIEW",
        status,
        latencyMs: Date.now() - startedAt,
        tokenUsage,
        errorCode
      });
    }
  }

  #route(shopId, confidence) {
    const config = this.shopConfigs[shopId] ?? DEFAULT_SHOP_CONFIG;
    if (config.reviewMode === "MANUAL") return "PENDING_REVIEW";
    if (config.reviewMode === "AUTO") return "SEND_READY";
    return confidence >= config.threshold ? "SEND_READY" : "PENDING_REVIEW";
  }
}

export { sanitizeDraft };

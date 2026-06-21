import { randomUUID } from "node:crypto";
import {
  HUMAN_HANDOFF_REPLY,
  PolicyClassifier
} from "./policyClassifier.js";
import { ContentSafety } from "./contentSafety.js";

const DEFAULT_SHOP_CONFIG = Object.freeze({
  reviewMode: "HYBRID",
  threshold: 0.9
});

function sanitizeDraft(reply) {
  return String(reply)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g, "[REDACTED_PHONE]")
    .replace(
      /\b(?:order|\u8ba2\u5355|\u5355\u53f7)\s*(?:id|\u53f7|\u7f16\u53f7)?\s*[:\uFF1A#-]?\s*[A-Z0-9-]{5,}\b/gi,
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
    contentSafety = new ContentSafety(),
    shopConfigs = {
      "demo-shop": { reviewMode: "MANUAL", threshold: 0.9 }
    }
  }) {
    this.vectorStore = vectorStore;
    this.provider = provider;
    this.reviewQueue = reviewQueue;
    this.auditLogger = auditLogger;
    this.policyClassifier = policyClassifier;
    this.contentSafety = contentSafety;
    this.shopConfigs = shopConfigs;
  }

  async preview({
    shopId,
    buyerMessage,
    requestId = randomUUID(),
    preGateResult,
    signal,
    pipelineTrace = []
  }) {
    const startedAt = Date.now();
    let tokenUsage = {};
    let status = "FAILED";

    try {
      if (preGateResult && !preGateResult.safe) {
        status = "NEEDS_HUMAN";
        return {
          requestId,
          status,
          reply: HUMAN_HANDOFF_REPLY,
          confidence: 0,
          knowledgeHit: false
        };
      }

      pipelineTrace.push("policyClassifier");
      const policy = await this.policyClassifier.classify(buyerMessage);
      if (policy.highRisk) {
        status = "NEEDS_HUMAN";
        return {
          requestId,
          status,
          reply: HUMAN_HANDOFF_REPLY,
          confidence: 0,
          knowledgeHit: false
        };
      }

      pipelineTrace.push("vectorStoreRetrieval");
      const knowledge = this.vectorStore.search(
        shopId,
        buyerMessage,
        3,
        shopId
      );
      pipelineTrace.push("deepseekGeneration");
      const result = await this.provider.generate({
        buyerMessage,
        knowledge,
        signal
      });
      tokenUsage = result.tokenUsage;
      const safeReply = sanitizeDraft(result.reply);
      pipelineTrace.push("responseSafetyPostCheck");
      const replySafety = this.contentSafety.scanReply(safeReply);

      if (result.needsHuman || !replySafety.safe) {
        status = "NEEDS_HUMAN";
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
          confidence: result.confidence
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
      return {
        requestId,
        status,
        reply: HUMAN_HANDOFF_REPLY,
        confidence: 0,
        knowledgeHit: false
      };
    } finally {
      pipelineTrace.push("auditLogger");
      this.auditLogger.record({
        requestId,
        shopId,
        action: "CHAT_PREVIEW",
        status,
        latencyMs: Date.now() - startedAt,
        tokenUsage
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

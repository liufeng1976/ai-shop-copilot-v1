import { randomUUID } from "node:crypto";

const HIGH_RISK_PATTERN =
  /退款金额|退多少钱|订单状态|订单到哪|物流状态|物流到哪|赔偿|补偿|支付|付款|改价|修改价格|删除订单|取消订单|修改订单/i;

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
    shopConfigs = {
      "demo-shop": { reviewMode: "MANUAL", threshold: 0.9 }
    }
  }) {
    this.vectorStore = vectorStore;
    this.provider = provider;
    this.reviewQueue = reviewQueue;
    this.auditLogger = auditLogger;
    this.shopConfigs = shopConfigs;
  }

  async preview({ shopId, buyerMessage, requestId = randomUUID() }) {
    const startedAt = Date.now();
    let tokenUsage = {};
    let status = "FAILED";

    try {
      if (HIGH_RISK_PATTERN.test(buyerMessage)) {
        status = "NEEDS_HUMAN";
        return {
          requestId,
          status,
          reply: "该问题涉及高风险业务操作，请转人工客服处理。",
          confidence: 0,
          knowledgeHit: false
        };
      }

      const knowledge = this.vectorStore.search(shopId, buyerMessage, 3);
      const result = await this.provider.generate({ buyerMessage, knowledge });
      tokenUsage = result.tokenUsage;
      const safeReply = sanitizeDraft(result.reply);
      status = result.needsHuman
        ? "NEEDS_HUMAN"
        : this.#route(shopId, result.confidence);

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
      return {
        requestId,
        status,
        reply: "AI 回复生成失败，请转人工客服处理。",
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

export { HIGH_RISK_PATTERN, sanitizeDraft };

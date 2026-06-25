import { randomUUID } from "node:crypto";
import {
  HUMAN_HANDOFF_REPLY,
  PolicyClassifier
} from "./policyClassifier.js";
import { ContentSafety } from "./contentSafety.js";
import {
  CommerceIntentClassifier,
  COMMERCE_INTENTS
} from "./commerceIntentClassifier.js";

const DEFAULT_SHOP_CONFIG = Object.freeze({
  reviewMode: "HYBRID",
  threshold: 0.9
});

const INTENT_DRAFTS = Object.freeze({
  [COMMERCE_INTENTS.LOGISTICS]:
    "您好，您的物流/发货问题已收到。物流或订单信息需要人工客服核实后才能准确回复，我们会尽快为您确认，请稍等。",
  [COMMERCE_INTENTS.AFTER_SALE]:
    "您好，关于退款、退货、换货等售后问题，我们会根据店铺售后政策为您核实处理。具体处理结果需人工客服确认后回复，请稍等。",
  [COMMERCE_INTENTS.COMPLAINT_RISK]:
    "非常抱歉给您带来不好的体验，您的反馈我们已经收到。该问题将优先交由人工客服核实并安抚处理，请稍等。",
  [COMMERCE_INTENTS.ORDER_SENSITIVE]:
    "您好，您的问题涉及订单、支付、地址或联系方式等敏感信息，需要人工客服核实后为您处理，请稍等。",
  [COMMERCE_INTENTS.FORBIDDEN_ACTION]:
    "您好，您的问题涉及退款执行、改价、补偿或订单修改等操作，需要人工客服核实处理，暂不能直接承诺结果，请稍等。",
  [COMMERCE_INTENTS.UNKNOWN]:
    "您好，您的问题已收到，客服会尽快核实后回复您，请稍等。"
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
    metricsService,
    policyClassifier = new PolicyClassifier(),
    commerceIntentClassifier = new CommerceIntentClassifier(),
    contentSafety = new ContentSafety(),
    shopConfigs = {
      "demo-shop": { reviewMode: "MANUAL", threshold: 0.9 }
    }
  }) {
    this.vectorStore = vectorStore;
    this.provider = provider;
    this.reviewQueue = reviewQueue;
    this.auditLogger = auditLogger;
    this.metricsService = metricsService;
    this.policyClassifier = policyClassifier;
    this.commerceIntentClassifier = commerceIntentClassifier;
    this.contentSafety = contentSafety;
    this.shopConfigs = shopConfigs;
  }

  async preview({
    tenantContext,
    buyerMessage,
    requestId = randomUUID(),
    signal,
    pipelineTrace = []
  }) {
    const shopId = tenantContext?.shopId ?? "";
    const startedAt = Date.now();
    let tokenUsage = {};
    let status = "FAILED";
    let commerceIntent = {
      intent: COMMERCE_INTENTS.UNKNOWN,
      riskLevel: "LOW",
      allowAutoSend: false,
      allowDraft: false
    };

    try {
      pipelineTrace.push("commerceIntentClassifier");
      commerceIntent = this.commerceIntentClassifier.classify(buyerMessage);

      const internalPreGate = this.contentSafety.preGate(buyerMessage);
      const preGateRequiresTemplate = !internalPreGate.safe;

      pipelineTrace.push("policyClassifier");
      const policy = await this.policyClassifier.classify(buyerMessage);
      const policyRequiresTemplate = policy.highRisk;

      pipelineTrace.push("vectorStoreRetrieval");
      const knowledge = this.vectorStore.search(
        tenantContext,
        buyerMessage,
        3
      );

      const templateDraft = this.#templateDraftFor({
        commerceIntent,
        preGateRequiresTemplate,
        policyRequiresTemplate
      });
      if (templateDraft) {
        status = "PENDING_REVIEW";
        this.#enqueueReviewDraft({
          requestId,
          shopId,
          reply: templateDraft,
          buyerMessage,
          confidence: 0.6,
          commerceIntent
        });
        return this.#response({
          requestId,
          status,
          reply: templateDraft,
          confidence: 0.6,
          knowledgeHit: knowledge.length > 0,
          commerceIntent
        });
      }

      pipelineTrace.push("deepseekGeneration");
      const result = await this.provider.generate({
        buyerMessage,
        knowledge,
        signal
      });
      if (result.errorCode?.startsWith("LLM_")) {
        this.metricsService?.recordLlmFailure();
      }
      tokenUsage = result.tokenUsage;
      const safeReply = sanitizeDraft(result.reply);
      pipelineTrace.push("responseSafetyPostCheck");
      const replySafety = this.contentSafety.scanReply(safeReply);

      if (result.needsHuman || !replySafety.safe) {
        status = "NEEDS_HUMAN";
        return this.#response({
          requestId,
          status,
          reply: HUMAN_HANDOFF_REPLY,
          confidence: 0,
          knowledgeHit: knowledge.length > 0,
          commerceIntent
        });
      }

      status = "PENDING_REVIEW";
      this.#enqueueReviewDraft({
        requestId,
        shopId,
        reply: safeReply,
        buyerMessage,
        confidence: result.confidence,
        commerceIntent
      });

      return this.#response({
        requestId,
        status,
        reply: safeReply,
        confidence: result.confidence,
        knowledgeHit: knowledge.length > 0,
        commerceIntent
      });
    } catch {
      status = "NEEDS_HUMAN";
      return this.#response({
        requestId,
        status,
        reply: HUMAN_HANDOFF_REPLY,
        confidence: 0,
        knowledgeHit: false,
        commerceIntent
      });
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

  #templateDraftFor({
    commerceIntent,
    preGateRequiresTemplate,
    policyRequiresTemplate
  }) {
    if (commerceIntent.intent === COMMERCE_INTENTS.PRE_SALE) return null;
    if (Object.hasOwn(INTENT_DRAFTS, commerceIntent.intent)) {
      return INTENT_DRAFTS[commerceIntent.intent];
    }
    if (preGateRequiresTemplate || policyRequiresTemplate) {
      return INTENT_DRAFTS[COMMERCE_INTENTS.ORDER_SENSITIVE];
    }
    return null;
  }

  #enqueueReviewDraft({
    requestId,
    shopId,
    reply,
    buyerMessage,
    confidence,
    commerceIntent
  }) {
    const reviewSafeReply = this.contentSafety.sanitizeReviewReply(
      reply,
      buyerMessage
    );
    this.reviewQueue.enqueue({
      requestId,
      shopId,
      reviewSafety: reviewSafeReply,
      confidence,
      intent: commerceIntent?.intent,
      riskLevel: commerceIntent?.riskLevel
    });
  }

  #response({
    requestId,
    status,
    reply,
    confidence,
    knowledgeHit,
    commerceIntent
  }) {
    return {
      requestId,
      status,
      reply,
      confidence,
      knowledgeHit,
      intent: commerceIntent.intent,
      riskLevel: commerceIntent.riskLevel,
      allowAutoSend: false,
      reviewRequired: true
    };
  }
}

export { INTENT_DRAFTS, sanitizeDraft };

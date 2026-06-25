import { createReplyCommand } from "../domain/replyCommand.js";

const FALLBACK_REPLY = "您好，您的问题已收到，正在为您核实，请稍等。";
const HIGH_RISK_FALLBACK_REPLY =
  "您好，您的问题涉及订单/售后信息，需要人工客服核实后为您处理，请稍等。";

export class FallbackReplyService {
  constructor({ adapters = {}, highRiskClassifier } = {}) {
    this.adapters = adapters;
    this.highRiskClassifier = highRiskClassifier;
  }

  async sendFallback(record) {
    const adapter = this.adapters[String(record.platform)];
    if (!adapter || !adapter.getCapabilities?.().configured) {
      return { ok: false, code: "PLATFORM_NOT_CONFIGURED" };
    }
    const replyText = record.highRisk
      ? HIGH_RISK_FALLBACK_REPLY
      : FALLBACK_REPLY;
    const command = createReplyCommand({
      shopId: record.shop_id,
      platform: record.platform,
      conversationId: record.conversation_id,
      platformMessageId: record.platform_message_id,
      replyText,
      approvedBy: "system-sla-fallback",
      idempotencyKey: `${record.platform}:${record.shop_id}:${record.platform_message_id}:fallback`
    });
    const receipt = await adapter.sendReply(command);
    return {
      ok: receipt?.ok !== false && receipt?.code !== "PLATFORM_NOT_CONFIGURED",
      command,
      receipt
    };
  }
}

export { FALLBACK_REPLY, HIGH_RISK_FALLBACK_REPLY };

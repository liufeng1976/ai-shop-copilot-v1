const REPLY_COMMAND_FIELDS = Object.freeze([
  "shopId",
  "platform",
  "conversationId",
  "platformMessageId",
  "replyText",
  "approvedBy",
  "idempotencyKey"
]);

const FORBIDDEN_FIELDS = Object.freeze([
  "buyerMessage",
  "prompt",
  "kbContext",
  "rawContext",
  "vectorContext"
]);

export function createReplyCommand(input = {}) {
  for (const field of FORBIDDEN_FIELDS) {
    if (Object.hasOwn(input, field)) {
      throw new TypeError(`Forbidden reply command field: ${field}`);
    }
  }
  for (const field of REPLY_COMMAND_FIELDS) {
    if (!input[field]) throw new TypeError(`${field} is required`);
  }
  return Object.freeze({
    shopId: String(input.shopId),
    platform: String(input.platform),
    conversationId: String(input.conversationId),
    platformMessageId: String(input.platformMessageId),
    replyText: String(input.replyText),
    approvedBy: String(input.approvedBy),
    idempotencyKey: String(input.idempotencyKey)
  });
}

export { REPLY_COMMAND_FIELDS };

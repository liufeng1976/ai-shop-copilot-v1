const ALLOWED_FIELDS = Object.freeze([
  "platform",
  "shopId",
  "platformMessageId",
  "conversationId",
  "receivedAt",
  "messageText",
  "senderRole",
  "idempotencyKey"
]);

const FORBIDDEN_FIELDS = Object.freeze([
  "customerName",
  "customer_name",
  "phone",
  "address",
  "order",
  "orderDetails",
  "payment",
  "paymentDetails",
  "rawPayload",
  "raw_webhook_payload"
]);

function assertNoForbiddenFields(input) {
  for (const field of FORBIDDEN_FIELDS) {
    if (Object.hasOwn(input, field)) {
      throw new TypeError(`Forbidden platform message field: ${field}`);
    }
  }
}

export function createPlatformMessage(input = {}) {
  assertNoForbiddenFields(input);
  for (const field of ALLOWED_FIELDS) {
    if (field !== "receivedAt" && field !== "idempotencyKey" && !input[field]) {
      throw new TypeError(`${field} is required`);
    }
  }
  const message = {
    platform: String(input.platform),
    shopId: String(input.shopId),
    platformMessageId: String(input.platformMessageId),
    conversationId: String(input.conversationId),
    receivedAt: input.receivedAt
      ? new Date(input.receivedAt).toISOString()
      : new Date().toISOString(),
    messageText: String(input.messageText),
    senderRole: String(input.senderRole),
    idempotencyKey: String(
      input.idempotencyKey ??
        `${input.platform}:${input.shopId}:${input.platformMessageId}`
    )
  };
  return Object.freeze(message);
}

export { ALLOWED_FIELDS as PLATFORM_MESSAGE_FIELDS };

import { PlatformAdapter } from "./platformAdapter.js";
import { createPlatformMessage } from "../domain/platformMessage.js";

export class ManualAdapter extends PlatformAdapter {
  constructor({ webhookSecurity } = {}) {
    super({ platform: "manual", configured: true });
    this.webhookSecurity = webhookSecurity;
  }

  async verifyWebhook(request) {
    const body = request.rawBody ?? JSON.stringify(request.body ?? {});
    const result = this.webhookSecurity.verify({
      timestamp: request.get("X-Webhook-Timestamp"),
      signature: request.get("X-Webhook-Signature"),
      nonce: request.get("X-Webhook-Nonce"),
      body
    });
    return result.ok
      ? { ok: true, status: "VERIFIED" }
      : { ok: false, status: "REJECTED", code: result.code };
  }

  normalizeIncomingMessage(payload = {}) {
    return createPlatformMessage({
      platform: "manual",
      shopId: payload.shopId,
      platformMessageId: payload.platformMessageId,
      conversationId: payload.conversationId,
      receivedAt: payload.receivedAt,
      messageText: payload.messageText,
      senderRole: payload.senderRole,
      idempotencyKey: payload.idempotencyKey
    });
  }

  async sendReply(command) {
    return {
      ok: true,
      sent: false,
      status: "MANUAL_DELIVERY_REQUIRED",
      command
    };
  }

  getAuthorizationUrl(state) {
    return {
      ok: true,
      authorizationUrl: `/manual/integrations/authorize?state=${encodeURIComponent(state)}`
    };
  }

  async exchangeAuthorizationCode(_code) {
    return {
      ok: true,
      encryptedToken: null,
      keyVersion: null,
      tokenStorage: "not_persisted"
    };
  }

  async refreshAccessToken(_token) {
    return {
      ok: true,
      encryptedToken: null,
      keyVersion: null,
      tokenStorage: "not_persisted"
    };
  }

  getCapabilities() {
    return {
      platform: "manual",
      configured: true,
      webhook: true,
      oauth: true,
      sendReply: false
    };
  }
}

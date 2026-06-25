export const PLATFORM_NOT_CONFIGURED = Object.freeze({
  ok: false,
  status: "NOT_CONFIGURED",
  code: "PLATFORM_NOT_CONFIGURED"
});

export class PlatformAdapter {
  constructor({ platform, configured = false } = {}) {
    this.platform = platform ?? "unknown";
    this.configured = configured;
  }

  async verifyWebhook(_request) {
    return { ...PLATFORM_NOT_CONFIGURED };
  }

  normalizeIncomingMessage(_payload) {
    return { ...PLATFORM_NOT_CONFIGURED };
  }

  async sendReply(_command) {
    return { ...PLATFORM_NOT_CONFIGURED, sent: false };
  }

  getAuthorizationUrl(_state) {
    return { ...PLATFORM_NOT_CONFIGURED };
  }

  async exchangeAuthorizationCode(_code) {
    return { ...PLATFORM_NOT_CONFIGURED };
  }

  async refreshAccessToken(_token) {
    return { ...PLATFORM_NOT_CONFIGURED };
  }

  getCapabilities() {
    return {
      platform: this.platform,
      configured: this.configured,
      webhook: false,
      oauth: false,
      sendReply: false
    };
  }
}

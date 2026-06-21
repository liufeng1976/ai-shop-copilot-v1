import { randomUUID } from "node:crypto";
import { PlatformAdapter } from "./platformAdapter.js";

export class MockPlatformAdapter extends PlatformAdapter {
  async sendReply({ shopId, reply }) {
    if (!shopId || !reply) throw new TypeError("shopId and reply are required");
    return {
      provider: "mock",
      accepted: true,
      receiptId: randomUUID()
    };
  }
}

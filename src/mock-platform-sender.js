import { randomUUID } from "node:crypto";

export class MockPlatformSender {
  async send({ reviewId, message }) {
    if (!reviewId || !message) {
      throw new Error("reviewId and message are required");
    }

    return {
      provider: "mock",
      receiptId: randomUUID(),
      accepted: true,
      sentAt: new Date().toISOString()
    };
  }
}

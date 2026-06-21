import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { LocalVectorStore } from "../src/local-vector-store.js";
import { ReviewQueue } from "../src/review-queue.js";
import { containsForbiddenRequestFields, redactSensitiveText } from "../src/privacy.js";

test("sensitive patterns are redacted before persistence", () => {
  const text =
    "联系 buyer@example.com 或 13800138000，订单号 ORDER-ABC12345。";
  const redacted = redactSensitiveText(text);

  assert.doesNotMatch(redacted, /buyer@example\.com/);
  assert.doesNotMatch(redacted, /13800138000/);
  assert.doesNotMatch(redacted, /ORDER-ABC12345/);
});

test("review queue rejects forbidden private-data field shapes", () => {
  assert.equal(containsForbiddenRequestFields({ buyerMessage: "secret" }), true);
  assert.equal(containsForbiddenRequestFields({ metadata: { order: {} } }), true);
  assert.equal(containsForbiddenRequestFields({ customerProfile: {} }), true);
  assert.equal(containsForbiddenRequestFields({ draftReply: "safe" }), false);
});

test("buyer message, order, and customer profile never enter persistent services", async () => {
  const secrets = {
    buyerMessage: "我的邮箱 buyer@example.com，订单号 ORDER-ABC12345，想退货",
    order: {
      id: "ORDER-ABC12345",
      amount: 499
    },
    customer: {
      name: "Private Buyer",
      phone: "13800138000",
      address: "Private address"
    }
  };
  const vectorStore = new LocalVectorStore([
    {
      id: "returns",
      title: "退货",
      content: "七天内可申请退货。"
    }
  ]);
  const reviewQueue = new ReviewQueue();
  const deepSeekClient = {
    async draftReply() {
      return "请联系 buyer@example.com，核对订单号 ORDER-ABC12345 或电话 13800138000。";
    }
  };
  const app = await createApp({
    config: { reviewApiKey: "test-review-secret", deepSeek: {} },
    vectorStore,
    reviewQueue,
    deepSeekClient
  });

  const response = await request(app)
    .post("/api/v1/chat/preview")
    .send(secrets)
    .expect(201);

  const persistedSnapshot = JSON.stringify({
    reviewQueue: reviewQueue.list(),
    appServices: app.locals.services
  });

  for (const privateValue of [
    secrets.buyerMessage,
    secrets.order.id,
    secrets.customer.name,
    secrets.customer.phone,
    secrets.customer.address,
    "buyer@example.com"
  ]) {
    assert.equal(
      persistedSnapshot.includes(privateValue),
      false,
      `private value was persisted: ${privateValue}`
    );
  }

  assert.doesNotMatch(response.body.draftReply, /buyer@example\.com/);
  assert.doesNotMatch(response.body.draftReply, /ORDER-ABC12345/);
  assert.doesNotMatch(response.body.draftReply, /13800138000/);
  assert.equal(response.body.privacy.persistedBuyerMessage, false);
  assert.equal(response.body.privacy.persistedOrderData, false);
  assert.equal(response.body.privacy.persistedCustomerData, false);
});

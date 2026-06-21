import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { createApp } from "../src/server.js";
import { LocalVectorStore } from "../src/services/vectorStore.js";

function successfulProvider(confidence = 0.95) {
  return {
    async generate() {
      return {
        reply: "本店支持七天无理由退货。",
        confidence,
        needsHuman: false,
        tokenUsage: {
          prompt_tokens: 12,
          completion_tokens: 8,
          total_tokens: 20
        }
      };
    }
  };
}

test("buyerMessage never enters the audit log", async () => {
  const secret = "绝密买家原文 buyer@example.com 13800138000";
  const app = createApp({ provider: successfulProvider() });

  await request(app)
    .post("/api/v1/chat/preview")
    .send({ shopId: "demo-shop", buyerMessage: secret, requestId: "req-privacy-1" })
    .expect(200);

  const audit = app.locals.services.auditLogger.list();
  assert.equal(audit.length, 1);
  assert.deepEqual(Object.keys(audit[0]), [
    "request_id",
    "shop_id",
    "action",
    "status",
    "latency_ms",
    "token_usage"
  ]);
  assert.equal(JSON.stringify(audit).includes(secret), false);
  assert.equal(JSON.stringify(audit).includes("buyerMessage"), false);
});

test("buyerMessage, order and customer data never enter review_queue", async () => {
  const secret = "买家要求退货，姓名张三，电话13800138000";
  const app = createApp({ provider: successfulProvider(0.95) });

  await request(app)
    .post("/api/v1/chat/preview")
    .send({
      shopId: "demo-shop",
      buyerMessage: secret,
      order: { id: "ORDER-PRIVATE" },
      customer: { name: "张三", phone: "13800138000" }
    })
    .expect(200)
    .expect(({ body }) => assert.equal(body.status, "PENDING_REVIEW"));

  const queue = app.locals.services.reviewQueue.list({ shopId: "demo-shop" });
  const snapshot = JSON.stringify(queue);
  assert.equal(snapshot.includes(secret), false);
  assert.equal(snapshot.includes("ORDER-PRIVATE"), false);
  assert.equal(snapshot.includes("张三"), false);
  assert.equal(snapshot.includes("13800138000"), false);
  assert.equal(snapshot.includes("buyerMessage"), false);
});

test("a model cannot smuggle buyer PII into review_queue", async () => {
  const app = createApp({
    provider: {
      async generate() {
        return {
          reply:
            "请联系 buyer@example.com 或 13800138000，并核对订单号 ORDER-PRIVATE-123。",
          confidence: 0.99,
          needsHuman: false,
          tokenUsage: {}
        };
      }
    }
  });

  await request(app)
    .post("/api/v1/chat/preview")
    .send({ shopId: "demo-shop", buyerMessage: "我的售后怎么办？" })
    .expect(200);

  const snapshot = JSON.stringify(
    app.locals.services.reviewQueue.list({ shopId: "demo-shop" })
  );
  assert.equal(snapshot.includes("buyer@example.com"), false);
  assert.equal(snapshot.includes("13800138000"), false);
  assert.equal(snapshot.includes("ORDER-PRIVATE-123"), false);
});

test("Vector KB rejects private or transactional source types", () => {
  const vectorStore = new LocalVectorStore();
  for (const sourceType of [
    "buyer_message",
    "order",
    "customer",
    "payment",
    "logistics"
  ]) {
    assert.throws(
      () =>
        vectorStore.addDocument({
          shopId: "demo-shop",
          title: "禁止文档",
          sourceType,
          content: "不得保存"
        }),
      /sourceType is not allowed/
    );
  }
});

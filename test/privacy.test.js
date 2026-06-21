import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { createApp } from "../src/server.js";
import { LocalVectorStore } from "../src/services/vectorStore.js";

const API_KEY = "demo-secret-key";
const authenticated = (operation) => operation.set("X-API-Key", API_KEY);

function successfulProvider(confidence = 0.95, reply = "本店支持七天无理由退货。") {
  return {
    async generate() {
      return {
        reply,
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

test("audit log contains only approved metadata and no sensitive content", async () => {
  const buyerMessage = "绝密买家原文 buyer@example.com 13800138000";
  const aiReply = "独特的 AI 回复正文";
  const kbContent = "独特的静态知识库原文";
  const vectorStore = new LocalVectorStore();
  vectorStore.addDocument({
    shopId: "demo-shop",
    title: "售后政策",
    sourceType: "policy",
    content: kbContent
  });
  const app = createApp({
    vectorStore,
    provider: successfulProvider(0.95, aiReply)
  });

  await authenticated(
    request(app)
      .post("/api/v1/chat/preview")
      .send({ buyerMessage, requestId: "req-privacy-1" })
  ).expect(200);

  const audit = app.locals.services.auditLogger.list();
  const snapshot = JSON.stringify(audit);
  assert.equal(audit.length, 1);
  assert.deepEqual(Object.keys(audit[0]), [
    "request_id",
    "shop_id",
    "action",
    "status",
    "latency_ms",
    "token_usage"
  ]);
  assert.equal(snapshot.includes(buyerMessage), false);
  assert.equal(snapshot.includes(aiReply), false);
  assert.equal(snapshot.includes(kbContent), false);
  assert.equal(snapshot.includes("buyerMessage"), false);
  assert.equal(snapshot.includes("reply"), false);
});

test("buyerMessage and customer transaction data never enter review_queue", async () => {
  const secret = "买家要求退货，姓名张三，电话13800138000";
  const app = createApp({ provider: successfulProvider() });

  await authenticated(
    request(app).post("/api/v1/chat/preview").send({
      buyerMessage: secret,
      order: { id: "ORDER-PRIVATE" },
      customer: { name: "张三", phone: "13800138000" }
    })
  )
    .expect(200)
    .expect(({ body }) => assert.equal(body.status, "PENDING_REVIEW"));

  const snapshot = JSON.stringify(
    app.locals.services.reviewQueue.list({ shopId: "demo-shop" })
  );
  for (const forbidden of [
    secret,
    "ORDER-PRIVATE",
    "张三",
    "13800138000",
    "buyerMessage"
  ]) {
    assert.equal(snapshot.includes(forbidden), false);
  }
});

test("a model cannot smuggle buyer PII into review_queue", async () => {
  const app = createApp({
    provider: successfulProvider(
      0.99,
      "请联系 buyer@example.com 或 13800138000，并核对订单号 ORDER-PRIVATE-123。"
    )
  });

  await authenticated(
    request(app)
      .post("/api/v1/chat/preview")
      .send({ buyerMessage: "我的售后怎么办？" })
  ).expect(200);

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

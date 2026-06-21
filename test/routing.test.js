import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { createApp } from "../src/server.js";
import { DeepSeekProvider } from "../src/services/deepseek.js";

function providerResult({ confidence = 0.95, needsHuman = false } = {}) {
  return {
    async generate() {
      return {
        reply: "测试回复",
        confidence,
        needsHuman,
        tokenUsage: {}
      };
    }
  };
}

test("demo-shop MANUAL mode always enters review", async () => {
  const app = createApp({ provider: providerResult({ confidence: 1 }) });
  const response = await request(app)
    .post("/api/v1/chat/preview")
    .send({ shopId: "demo-shop", buyerMessage: "支持退货吗？" })
    .expect(200);

  assert.equal(response.body.status, "PENDING_REVIEW");
  assert.equal(app.locals.services.reviewQueue.list({ shopId: "demo-shop" }).length, 1);
});

test("HYBRID mode routes by threshold", async () => {
  const highApp = createApp({
    provider: providerResult({ confidence: 0.9 }),
    shopConfigs: { hybrid: { reviewMode: "HYBRID", threshold: 0.9 } }
  });
  const lowApp = createApp({
    provider: providerResult({ confidence: 0.89 }),
    shopConfigs: { hybrid: { reviewMode: "HYBRID", threshold: 0.9 } }
  });

  const high = await request(highApp)
    .post("/api/v1/chat/preview")
    .send({ shopId: "hybrid", buyerMessage: "退货政策是什么？" })
    .expect(200);
  const low = await request(lowApp)
    .post("/api/v1/chat/preview")
    .send({ shopId: "hybrid", buyerMessage: "退货政策是什么？" })
    .expect(200);

  assert.equal(high.body.status, "SEND_READY");
  assert.equal(low.body.status, "PENDING_REVIEW");
});

test("invalid DeepSeek JSON safely degrades to NEEDS_HUMAN", async () => {
  const provider = new DeepSeekProvider({
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { choices: [{ message: { content: "not-json" } }] };
      }
    })
  });
  const app = createApp({ provider });
  const response = await request(app)
    .post("/api/v1/chat/preview")
    .send({ shopId: "demo-shop", buyerMessage: "退货政策是什么？" })
    .expect(200);

  assert.equal(response.body.status, "NEEDS_HUMAN");
  assert.equal(app.locals.services.reviewQueue.list({ shopId: "demo-shop" }).length, 0);
});

test("DeepSeek uses the default model, JSON mode and static-knowledge system prompt", async () => {
  let capturedBody;
  const previousModel = process.env.DEEPSEEK_MODEL;
  delete process.env.DEEPSEEK_MODEL;
  try {
    const provider = new DeepSeekProvider({
      apiKey: "test-key",
      fetchImpl: async (_url, options) => {
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          async json() {
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      reply: "静态知识回复",
                      confidence: 0.93,
                      needs_human: false
                    })
                  }
                }
              ]
            };
          }
        };
      }
    });

    await provider.generate({
      buyerMessage: "支持退货吗？",
      knowledge: [
        {
          title: "售后政策",
          sourceType: "policy",
          content: "七天内可退货。"
        }
      ]
    });
  } finally {
    if (previousModel === undefined) delete process.env.DEEPSEEK_MODEL;
    else process.env.DEEPSEEK_MODEL = previousModel;
  }

  assert.equal(capturedBody.model, "deepseek-v4-flash");
  assert.deepEqual(capturedBody.response_format, { type: "json_object" });
  assert.match(
    capturedBody.messages[0].content,
    /STATIC KNOWLEDGE CONTEXT \(NON-USER DATA\)/
  );
});

test("high-risk questions enter human handling without invoking the LLM", async () => {
  let calls = 0;
  const app = createApp({
    provider: {
      async generate() {
        calls += 1;
        return providerResult();
      }
    }
  });
  const response = await request(app)
    .post("/api/v1/chat/preview")
    .send({ shopId: "demo-shop", buyerMessage: "请告诉我订单状态和退款金额" })
    .expect(200);

  assert.equal(response.body.status, "NEEDS_HUMAN");
  assert.equal(calls, 0);
});

test("review approval uses the mock platform adapter and rejection is supported", async () => {
  const app = createApp({ provider: providerResult() });
  await request(app)
    .post("/api/v1/chat/preview")
    .send({ shopId: "demo-shop", buyerMessage: "支持退货吗？" })
    .expect(200);
  const [first] = app.locals.services.reviewQueue.list({ shopId: "demo-shop" });
  const approved = await request(app)
    .post(`/api/v1/reviews/${first.id}/approve`)
    .expect(200);
  assert.equal(approved.body.review.status, "APPROVED");
  assert.equal(approved.body.receipt.provider, "mock");

  await request(app)
    .post("/api/v1/chat/preview")
    .send({ shopId: "demo-shop", buyerMessage: "支持退货吗？" })
    .expect(200);
  const pending = app.locals.services.reviewQueue
    .list({ shopId: "demo-shop", status: "PENDING" })[0];
  const rejected = await request(app)
    .post(`/api/v1/reviews/${pending.id}/reject`)
    .expect(200);
  assert.equal(rejected.body.review.status, "REJECTED");
});

import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/server.js";

const API_KEY = "demo-secret-key";

function providerResult(reply = "这是基于静态知识生成的售前客服草稿。") {
  let calls = 0;
  return {
    provider: {
      async generate() {
        calls += 1;
        return {
          reply,
          confidence: 0.95,
          needsHuman: false,
          tokenUsage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          errorCode: null
        };
      }
    },
    get calls() {
      return calls;
    }
  };
}

async function chat(app, buyerMessage) {
  return request(app)
    .post("/api/v1/chat/preview")
    .set("X-API-Key", API_KEY)
    .send({ buyerMessage })
    .expect(200);
}

test("chatService adds commerce intent metadata and keeps pre-sale draft in review", async () => {
  const provider = providerResult();
  const app = createApp({ provider: provider.provider });
  const response = await chat(app, "这款商品规格和尺码怎么选？");

  assert.equal(response.body.intent, "PRE_SALE");
  assert.equal(response.body.riskLevel, "LOW");
  assert.equal(response.body.status, "PENDING_REVIEW");
  assert.equal(response.body.allowAutoSend, false);
  assert.equal(response.body.reviewRequired, true);
  assert.equal(provider.calls, 1);
  assert.equal(app.locals.services.reviewQueue.list({ shopId: "demo-shop" }).length, 1);
});

test("chatService logistics draft only comforts and routes to review", async () => {
  const provider = providerResult();
  const app = createApp({ provider: provider.provider });
  const response = await chat(app, "我的快递到哪了，可以催发货吗？");

  assert.equal(response.body.intent, "LOGISTICS");
  assert.equal(response.body.status, "PENDING_REVIEW");
  assert.match(response.body.reply, /人工客服核实/);
  assert.equal(provider.calls, 0);
});

test("chatService after-sale draft is policy-oriented without promising outcome", async () => {
  const app = createApp({ provider: providerResult().provider });
  const response = await chat(app, "商品有质量问题，我想了解退货换货售后政策");

  assert.equal(response.body.intent, "AFTER_SALE");
  assert.equal(response.body.status, "PENDING_REVIEW");
  assert.match(response.body.reply, /售后政策/);
  assert.doesNotMatch(response.body.reply, /退款\d+|赔偿\d+|马上退款/);
});

test("chatService complaint risk draft prioritizes human soothing", async () => {
  const app = createApp({ provider: providerResult().provider });
  const response = await chat(app, "你们客服太差了，我要投诉给差评");

  assert.equal(response.body.intent, "COMPLAINT_RISK");
  assert.equal(response.body.status, "PENDING_REVIEW");
  assert.match(response.body.reply, /抱歉|优先/);
});

test("chatService order-sensitive draft asks for human verification", async () => {
  const app = createApp({ provider: providerResult().provider });
  const response = await chat(app, "帮我查订单状态，再改一下手机号和地址");

  assert.equal(response.body.intent, "ORDER_SENSITIVE");
  assert.equal(response.body.riskLevel, "HIGH");
  assert.equal(response.body.status, "PENDING_REVIEW");
  assert.match(response.body.reply, /敏感信息|人工客服核实/);
});

test("chatService forbidden action draft never promises refund, compensation or price change", async () => {
  const provider = providerResult();
  const app = createApp({ provider: provider.provider });
  const response = await chat(app, "你直接给我退款100元并改价补偿");

  assert.equal(response.body.intent, "FORBIDDEN_ACTION");
  assert.equal(response.body.riskLevel, "HIGH");
  assert.equal(response.body.status, "PENDING_REVIEW");
  assert.equal(response.body.allowAutoSend, false);
  assert.match(response.body.reply, /不能直接承诺结果|人工客服核实/);
  assert.equal(provider.calls, 0);
});

test("chatService unknown draft uses ordinary fallback and still requires review", async () => {
  const app = createApp({ provider: providerResult().provider });
  const response = await chat(app, "你好");

  assert.equal(response.body.intent, "UNKNOWN");
  assert.equal(response.body.status, "PENDING_REVIEW");
  assert.equal(response.body.allowAutoSend, false);
  assert.equal(response.body.reviewRequired, true);
});

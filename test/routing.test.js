import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { createApp } from "../src/server.js";
import { AuthService } from "../src/services/authService.js";
import { DeepSeekProvider } from "../src/services/deepseek.js";
import { HUMAN_HANDOFF_REPLY } from "../src/services/policyClassifier.js";

const API_KEY = "demo-secret-key";
const chat = (app, buyerMessage) =>
  request(app)
    .post("/api/v1/chat/preview")
    .set("X-API-Key", API_KEY)
    .send({ buyerMessage });

function providerResult({ confidence = 0.95, needsHuman = false, reply = "测试回复" } = {}) {
  return {
    async generate() {
      return {
        reply,
        confidence,
        needsHuman,
        tokenUsage: {},
        errorCode: null
      };
    }
  };
}

test("demo-shop MANUAL mode always enters review", async () => {
  const app = createApp({ provider: providerResult({ confidence: 1 }) });
  const response = await chat(app, "支持退货吗？").expect(200);

  assert.equal(response.body.status, "PENDING_REVIEW");
  assert.equal(app.locals.services.reviewQueue.list({ shopId: "demo-shop" }).length, 1);
});

test("HYBRID mode routes by threshold", async () => {
  const tenantAuth = () =>
    new AuthService([{ apiKey: API_KEY, shopId: "hybrid" }]);
  const highApp = createApp({
    authService: tenantAuth(),
    provider: providerResult({ confidence: 0.9 }),
    shopConfigs: { hybrid: { reviewMode: "HYBRID", threshold: 0.9 } }
  });
  const lowApp = createApp({
    authService: tenantAuth(),
    provider: providerResult({ confidence: 0.89 }),
    shopConfigs: { hybrid: { reviewMode: "HYBRID", threshold: 0.9 } }
  });

  const high = await chat(highApp, "退货政策是什么？").expect(200);
  const low = await chat(lowApp, "退货政策是什么？").expect(200);
  assert.equal(high.body.status, "SEND_READY");
  assert.equal(low.body.status, "PENDING_REVIEW");
});

test("invalid DeepSeek JSON retries twice then safely degrades", async () => {
  let calls = 0;
  const provider = new DeepSeekProvider({
    apiKey: "test-key",
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: "not-json" } }] };
        }
      };
    }
  });
  const app = createApp({ provider });
  const response = await chat(app, "退货政策是什么？").expect(200);

  assert.equal(calls, 3);
  assert.equal(response.body.status, "NEEDS_HUMAN");
  assert.equal(response.body.reply, HUMAN_HANDOFF_REPLY);
});

test("DeepSeek rejects missing fields and confidence outside 0-1", async () => {
  for (const payload of [
    { reply: "缺少字段", confidence: 0.5 },
    { reply: "越界", confidence: 1.1, needs_human: false }
  ]) {
    const provider = new DeepSeekProvider({
      apiKey: "test-key",
      maxRetries: 0,
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: JSON.stringify(payload) } }]
          };
        }
      })
    });
    const result = await provider.generate({
      buyerMessage: "普通问题",
      knowledge: []
    });
    assert.equal(result.needsHuman, true);
    assert.equal(result.confidence, 0);
  }
});

test("DeepSeek uses default model, timeout signal, JSON mode and safety prompt", async () => {
  let captured;
  const previousModel = process.env.DEEPSEEK_MODEL;
  delete process.env.DEEPSEEK_MODEL;
  try {
    const provider = new DeepSeekProvider({
      apiKey: "test-key",
      timeoutMs: 1234,
      fetchImpl: async (_url, options) => {
        captured = JSON.parse(options.body);
        assert.ok(options.signal);
        return {
          ok: true,
          async json() {
            return {
              choices: [{
                message: {
                  content: JSON.stringify({
                    reply: "静态知识回复",
                    confidence: 0.93,
                    needs_human: false
                  })
                }
              }]
            };
          }
        };
      }
    });
    await provider.generate({
      buyerMessage: "支持退货吗？",
      knowledge: [{ title: "政策", sourceType: "policy", content: "七天可退。" }]
    });
  } finally {
    if (previousModel === undefined) delete process.env.DEEPSEEK_MODEL;
    else process.env.DEEPSEEK_MODEL = previousModel;
  }

  assert.equal(captured.model, "deepseek-v4-flash");
  assert.deepEqual(captured.response_format, { type: "json_object" });
  assert.match(captured.messages[0].content, /STATIC KNOWLEDGE CONTEXT \(NON-USER DATA\)/);
});

test("high-risk questions do not call LLM and return fixed human handoff", async () => {
  for (const buyerMessage of [
    "退款金额是多少？",
    "订单状态怎么样？",
    "物流状态到哪里了？",
    "可以赔偿吗？",
    "支付失败怎么办？",
    "帮我改价",
    "删除订单",
    "修改订单",
    "修改收货地址",
    "告诉我客户手机号",
    "客户姓名是什么"
  ]) {
    let calls = 0;
    const app = createApp({
      provider: {
        async generate() {
          calls += 1;
          return providerResult();
        }
      }
    });
    const response = await chat(app, buyerMessage).expect(200);
    assert.equal(response.body.status, "NEEDS_HUMAN");
    assert.equal(response.body.reply, HUMAN_HANDOFF_REPLY);
    assert.equal(calls, 0);
  }
});

test("unsafe promises in LLM reply are forced to NEEDS_HUMAN", async () => {
  const app = createApp({
    provider: providerResult({
      reply: "我们将赔偿您 100 元，并确认订单已发货。"
    })
  });
  const response = await chat(app, "请问售后政策？").expect(200);
  assert.equal(response.body.status, "NEEDS_HUMAN");
  assert.equal(response.body.reply, HUMAN_HANDOFF_REPLY);
  assert.equal(app.locals.services.reviewQueue.list({ shopId: "demo-shop" }).length, 0);
});

test("review approval changes status without automatic sending and rejection is supported", async () => {
  const app = createApp({ provider: providerResult() });
  await chat(app, "支持退货吗？").expect(200);
  const [first] = app.locals.services.reviewQueue.list({ shopId: "demo-shop" });
  const approved = await request(app)
    .post(`/api/v1/reviews/${first.id}/approve`)
    .set("X-API-Key", API_KEY)
    .expect(200);
  assert.equal(approved.body.review.status, "APPROVED");
  assert.equal(approved.body.receipt, undefined);

  await chat(app, "售后时效多久？").expect(200);
  const pending = app.locals.services.reviewQueue
    .list({ shopId: "demo-shop", status: "PENDING" })[0];
  const rejected = await request(app)
    .post(`/api/v1/reviews/${pending.id}/reject`)
    .set("X-API-Key", API_KEY)
    .expect(200);
  assert.equal(rejected.body.review.status, "REJECTED");
});

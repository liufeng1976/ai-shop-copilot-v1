import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { createApp } from "../src/server.js";
import { AuthService } from "../src/services/authService.js";
import { DeepSeekProvider } from "../src/services/deepseek.js";
import { ReviewQueue } from "../src/services/reviewQueue.js";
import { HUMAN_HANDOFF_REPLY } from "../src/services/policyClassifier.js";

const API_KEY = "demo-secret-key";
const withAuth = (operation, apiKey = API_KEY) =>
  operation.set("X-API-Key", apiKey);

function validResponse(content = {}) {
  return {
    ok: true,
    async json() {
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              reply: "Static policy answer",
              confidence: 0.9,
              needs_human: false,
              ...content
            })
          }
        }]
      };
    }
  };
}

test("P1 rejects private or transactional KB content without echoing it", async () => {
  const unsafeContents = [
    "Buyer message: please call me",
    "Chat transcript: buyer asked for help",
    "Order ID: ORDER-987654",
    "Tracking number: SF1234567890",
    "Phone: +1 415 555 2671",
    "Shipping address: 123 Private Street",
    "Payment status: completed",
    "Customer name: Private Buyer",
    "Logistics status: delivered",
    "Refund transaction: RF-123456"
  ];

  for (const content of unsafeContents) {
    const app = createApp();
    const response = await withAuth(
      request(app).post("/api/v1/kb/documents").send({
        title: "Rejected document",
        sourceType: "policy",
        content
      })
    ).expect(400);
    assert.equal(response.body.code, "KB_CONTENT_REJECTED");
    assert.equal(JSON.stringify(response.body).includes(content), false);
    assert.equal(
      app.locals.services.vectorStore.listDocuments("demo-shop").length,
      0
    );
  }
});

test("P1 rejects any client-provided shopId even when it matches the API key", async () => {
  const app = createApp();
  await withAuth(
    request(app)
      .post("/api/v1/chat/preview")
      .send({ shopId: "demo-shop", buyerMessage: "General FAQ question" })
  ).expect(403);
  await withAuth(
    request(app).get("/api/v1/kb/documents?shopId=demo-shop")
  ).expect(403);
  await withAuth(
    request(app).get("/api/v1/reviews?shopId=demo-shop")
  ).expect(403);
});

test("P1 DeepSeek timeout safely falls back", async () => {
  const timeout = Object.assign(new Error("timeout"), { name: "TimeoutError" });
  const provider = new DeepSeekProvider({
    apiKey: "test-key",
    maxRetries: 0,
    fetchImpl: async () => { throw timeout; }
  });
  const result = await provider.generate({ buyerMessage: "FAQ", knowledge: [] });
  assert.equal(result.needsHuman, true);
  assert.equal(result.errorCode, "LLM_TIMEOUT");
});

test("P1 DeepSeek retry succeeds after a transient failure", async () => {
  let calls = 0;
  const provider = new DeepSeekProvider({
    apiKey: "test-key",
    maxRetries: 2,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return validResponse();
    }
  });
  const result = await provider.generate({ buyerMessage: "FAQ", knowledge: [] });
  assert.equal(calls, 2);
  assert.equal(result.needsHuman, false);
  assert.equal(result.confidence, 0.9);
});

test("P1 DeepSeek retry exhaustion returns NEEDS_HUMAN", async () => {
  let calls = 0;
  const provider = new DeepSeekProvider({
    apiKey: "test-key",
    maxRetries: 2,
    fetchImpl: async () => {
      calls += 1;
      throw new Error("unavailable");
    }
  });
  const app = createApp({ provider });
  const response = await withAuth(
    request(app)
      .post("/api/v1/chat/preview")
      .send({ buyerMessage: "General FAQ question" })
  ).expect(200);
  assert.equal(calls, 3);
  assert.equal(response.body.status, "NEEDS_HUMAN");
  assert.equal(response.body.reply, HUMAN_HANDOFF_REPLY);
});

test("P1 DeepSeek malformed responses all fail safe", async () => {
  const cases = [
    "not-json",
    JSON.stringify({ reply: "missing fields", confidence: 0.8 }),
    JSON.stringify({ reply: "too high", confidence: 1.1, needs_human: false }),
    JSON.stringify({ reply: "too low", confidence: -0.1, needs_human: false })
  ];
  for (const content of cases) {
    const provider = new DeepSeekProvider({
      apiKey: "test-key",
      maxRetries: 0,
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return { choices: [{ message: { content } }] };
        }
      })
    });
    const result = await provider.generate({ buyerMessage: "FAQ", knowledge: [] });
    assert.equal(result.needsHuman, true);
    assert.equal(result.confidence, 0);
  }
});

test("P1 high-risk categories never call the provider", async () => {
  const inputs = [
    "What refund amount will I get?",
    "What is my order status?",
    "What is the logistics status?",
    "My phone number changed",
    "Change my shipping address",
    "Promise compensation",
    "Please change the price"
  ];
  for (const buyerMessage of inputs) {
    let calls = 0;
    const app = createApp({
      provider: {
        async generate() {
          calls += 1;
          throw new Error("must not be called");
        }
      }
    });
    const response = await withAuth(
      request(app).post("/api/v1/chat/preview").send({ buyerMessage })
    ).expect(200);
    assert.equal(calls, 0);
    assert.equal(response.body.status, "NEEDS_HUMAN");
    assert.equal(response.body.reply, HUMAN_HANDOFF_REPLY);
  }
});

test("P1 tenant B cannot approve or reject tenant A review", async () => {
  const authService = new AuthService([
    { apiKey: "key-a", shopId: "shop-a" },
    { apiKey: "key-b", shopId: "shop-b" }
  ]);
  const reviewQueue = new ReviewQueue();
  const item = reviewQueue.enqueue({
    shopId: "shop-a",
    requestId: "request-a",
    reply: "safe draft",
    confidence: 0.8
  });
  const app = createApp({ authService, reviewQueue });

  await withAuth(
    request(app).post(`/api/v1/reviews/${item.id}/approve`),
    "key-b"
  ).expect(404);
  await withAuth(
    request(app).post(`/api/v1/reviews/${item.id}/reject`),
    "key-b"
  ).expect(404);

  const [unchanged] = reviewQueue.list({ shopId: "shop-a" });
  assert.equal(unchanged.status, "PENDING");
});

test("P1 production startup rejects the demo API key", () => {
  assert.throws(
    () => new AuthService(undefined, { nodeEnv: "production" }),
    /demo-secret-key is forbidden in production/
  );
  assert.doesNotThrow(
    () => new AuthService(
      [{ apiKey: "production-secret", shopId: "production-shop" }],
      { nodeEnv: "production" }
    )
  );
});

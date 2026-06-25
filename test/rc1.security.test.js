import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { createApp } from "../src/server.js";
import {
  AuthService,
  createAuthenticatedTenantContext
} from "../src/services/authService.js";
import { DeepSeekProvider } from "../src/services/deepseek.js";
import { createRateLimit } from "../src/middleware/rateLimit.js";
import { HUMAN_HANDOFF_REPLY } from "../src/services/policyClassifier.js";
import { AuditLogger } from "../src/services/auditLogger.js";
import { ReviewQueue } from "../src/services/reviewQueue.js";
import { LocalVectorStore } from "../src/services/vectorStore.js";
import { ContentSafety } from "../src/services/contentSafety.js";

const API_KEY = "demo-secret-key";
const demoTenant = () =>
  createAuthenticatedTenantContext({
    shopId: "demo-shop",
    apiKeyId: "test-demo-hash"
  });

function auth(operation, apiKey = API_KEY) {
  return operation.set("X-API-Key", apiKey);
}

function safeProvider({ reply = "静态知识回复", confidence = 0.9 } = {}) {
  return {
    async generate() {
      return {
        reply,
        confidence,
        needsHuman: false,
        tokenUsage: {},
        errorCode: null
      };
    }
  };
}

test("RC1 rejects missing and invalid API keys", async () => {
  const app = createApp();
  await request(app).get("/api/v1/kb/documents").expect(401);
  await auth(request(app).get("/api/v1/kb/documents"), "invalid").expect(401);
});

test("RC1 rejects shopId spoof attempts", async () => {
  const app = createApp();
  await auth(
    request(app)
      .post("/api/v1/chat/preview")
      .send({ shopId: "victim-shop", buyerMessage: "普通售后问题" })
  ).expect(403);
  await auth(
    request(app).get("/api/v1/kb/documents?shopId=victim-shop")
  ).expect(403);
});

test("RC1 buyerMessage is absent from audit and review queue", async () => {
  const buyerMessage = "唯一买家消息 buyer-secret-67890";
  const app = createApp({ provider: safeProvider() });
  await auth(
    request(app)
      .post("/api/v1/chat/preview")
      .send({ buyerMessage, requestId: "rc1-request" })
  ).expect(200);

  const auditSnapshot = JSON.stringify(app.locals.services.auditLogger.list());
  const reviews = app.locals.services.reviewQueue.list({ shopId: "demo-shop" });
  const reviewSnapshot = JSON.stringify(reviews);
  assert.equal(auditSnapshot.includes(buyerMessage), false);
  assert.equal(reviewSnapshot.includes(buyerMessage), false);
  assert.deepEqual(Object.keys(reviews[0]), [
    "id",
    "shop_id",
    "request_id",
    "ai_reply",
    "confidence",
    "status"
  ]);
});

test("RC1 audit logger drops all non-whitelisted text fields", () => {
  const logger = new AuditLogger();
  const record = logger.record({
    requestId: "request-id",
    shopId: "demo-shop",
    action: "CHAT_PREVIEW",
    status: "NEEDS_HUMAN",
    latencyMs: 4,
    tokenUsage: {},
    buyerMessage: "must-not-persist",
    ai_reply: "must-not-persist",
    content: "must-not-persist",
    errorCode: "must-not-persist"
  });
  assert.deepEqual(Object.keys(record), [
    "request_id",
    "shop_id",
    "action",
    "status",
    "latency_ms",
    "token_usage"
  ]);
  assert.equal(JSON.stringify(record).includes("must-not-persist"), false);
});

test("RC1 review queue rejects buyerMessage and stores an exact schema", () => {
  const queue = new ReviewQueue();
  assert.throws(
    () =>
      queue.enqueue({
        shopId: "demo-shop",
        requestId: "request-id",
        reply: "safe",
        confidence: 0.9,
        buyerMessage: "forbidden"
      }),
    /Sensitive context is forbidden/
  );
  const item = queue.enqueue({
    shopId: "demo-shop",
    requestId: "request-id",
    reviewSafety: new ContentSafety().sanitizeReviewReply(
      "safe",
      "unrelated buyer question"
    ),
    confidence: 0.9,
    extraText: "discarded"
  });
  assert.deepEqual(Object.keys(item), [
    "id",
    "shop_id",
    "request_id",
    "ai_reply",
    "confidence",
    "status"
  ]);
  assert.equal(JSON.stringify(item).includes("discarded"), false);
});

test("RC1 vector store only accepts faq, policy and tone", () => {
  const store = new LocalVectorStore();
  for (const sourceType of ["faq", "policy", "tone"]) {
    assert.doesNotThrow(() =>
      store.addDocument(demoTenant(), {
        title: sourceType,
        sourceType,
        content: "static merchant content"
      })
    );
  }
  for (const sourceType of ["product", "script", "buyer_message", "customer"]) {
    assert.throws(() =>
      store.addDocument(demoTenant(), {
        title: sourceType,
        sourceType,
        content: "forbidden"
      })
    );
  }
});

test("RC1 KB cannot leak across API-key tenants", async () => {
  const authService = new AuthService([
    { apiKey: "key-a", shopId: "shop-a" },
    { apiKey: "key-b", shopId: "shop-b" }
  ]);
  const app = createApp({ authService });
  await auth(
    request(app).post("/api/v1/kb/documents").send({
      title: "B policy",
      sourceType: "policy",
      content: "B tenant private static content"
    }),
    "key-b"
  ).expect(201);

  const response = await auth(
    request(app).get("/api/v1/kb/documents"),
    "key-a"
  ).expect(200);
  assert.deepEqual(response.body.items, []);
});

test("RC1 rate limiter returns 429", async () => {
  const app = createApp({
    rateLimit: createRateLimit({ limit: 1, windowMs: 60_000 })
  });
  await auth(request(app).get("/api/v1/kb/documents")).expect(200);
  await auth(request(app).get("/api/v1/kb/documents")).expect(429);
});

test("RC1 high-risk input bypasses LLM and fails safe", async () => {
  let calls = 0;
  const app = createApp({
    provider: {
      async generate() {
        calls += 1;
        return safeProvider();
      }
    }
  });
  const response = await auth(
    request(app)
      .post("/api/v1/chat/preview")
      .send({ buyerMessage: "Please modify my order and refund payment" })
  ).expect(200);
  assert.equal(response.body.status, "PENDING_REVIEW");
  assert.equal(response.body.allowAutoSend, false);
  assert.equal(calls, 0);
});

test("RC1 invalid DeepSeek JSON falls back to safe mode", async () => {
  const provider = new DeepSeekProvider({
    apiKey: "test-key",
    maxRetries: 0,
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { choices: [{ message: { content: "invalid-json" } }] };
      }
    })
  });
  const app = createApp({ provider });
  const response = await auth(
    request(app)
      .post("/api/v1/chat/preview")
        .send({ buyerMessage: "product size guide" })
  ).expect(200);
  assert.equal(response.body.status, "NEEDS_HUMAN");
  assert.equal(response.body.reply, HUMAN_HANDOFF_REPLY);
});

test("RC1 confidence below 0.5 falls back to safe mode", async () => {
  const provider = new DeepSeekProvider({
    apiKey: "test-key",
    maxRetries: 0,
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                reply: "低置信回复",
                confidence: 0.49,
                needs_human: false
              })
            }
          }]
        };
      }
    })
  });
  const app = createApp({ provider });
  const response = await auth(
    request(app)
      .post("/api/v1/chat/preview")
        .send({ buyerMessage: "product size guide" })
  ).expect(200);
  assert.equal(response.body.status, "NEEDS_HUMAN");
});

test("RC1 DeepSeek default timeout is 5 seconds", () => {
  const previousTimeout = process.env.DEEPSEEK_TIMEOUT_MS;
  delete process.env.DEEPSEEK_TIMEOUT_MS;
  try {
    const provider = new DeepSeekProvider();
    assert.equal(provider.timeoutMs, 5000);
    assert.equal(provider.maxRetries, 2);
  } finally {
    if (previousTimeout === undefined) delete process.env.DEEPSEEK_TIMEOUT_MS;
    else process.env.DEEPSEEK_TIMEOUT_MS = previousTimeout;
  }
});

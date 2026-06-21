import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import {
  createApp,
  SECURITY_PIPELINE_ORDER
} from "../src/server.js";
import { ReviewQueue } from "../src/services/reviewQueue.js";
import { LocalVectorStore } from "../src/services/vectorStore.js";
import { createRequestTimeout } from "../src/middleware/requestTimeout.js";
import { HUMAN_HANDOFF_REPLY } from "../src/services/policyClassifier.js";
import { createAuthenticatedTenantContext } from "../src/services/authService.js";
import { ContentSafety } from "../src/services/contentSafety.js";

const API_KEY = "demo-secret-key";
const authenticated = (operation) =>
  operation.set("X-API-Key", API_KEY);
const tenant = (shopId) =>
  createAuthenticatedTenantContext({
    shopId,
    apiKeyId: `test-hash-${shopId}`
  });

function safeProvider({ reply = "Static FAQ answer", confidence = 0.95 } = {}) {
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

test("RC1.5 contentSafety pre-gate executes before policy and LLM", async () => {
  let policyCalls = 0;
  let providerCalls = 0;
  const app = createApp({
    policyClassifier: {
      async classify() {
        policyCalls += 1;
        return { highRisk: false, code: null };
      }
    },
    provider: {
      async generate() {
        providerCalls += 1;
        return safeProvider();
      }
    }
  });

  const response = await authenticated(
    request(app)
      .post("/api/v1/chat/preview")
      .send({ buyerMessage: "What refund will I receive?" })
  ).expect(200);

  assert.equal(response.body.status, "NEEDS_HUMAN");
  assert.equal(response.body.reply, HUMAN_HANDOFF_REPLY);
  assert.equal(policyCalls, 0);
  assert.equal(providerCalls, 0);
});

test("RC1.5 rejects fake shopId from body, query, and headers", async () => {
  const app = createApp();
  await authenticated(
    request(app)
      .post("/api/v1/chat/preview")
      .send({ shopId: "demo-shop", buyerMessage: "General FAQ" })
  ).expect(403);
  await authenticated(
    request(app).get("/api/v1/reviews?shopId=demo-shop")
  ).expect(403);
  await authenticated(
    request(app)
      .get("/api/v1/kb/documents")
      .set("X-Shop-Id", "demo-shop")
  ).expect(403);
});

test("RC1.5 review queue stores only the six allowed fields", () => {
  const queue = new ReviewQueue();
  for (const forbidden of [
    { buyerMessage: "private" },
    { rawContext: "private" },
    { vectorContext: "private" },
    { llmPrompt: "private" }
  ]) {
    assert.throws(
      () =>
        queue.enqueue({
          shopId: "demo-shop",
          requestId: "request-id",
          reply: "safe reply",
          confidence: 0.9,
          ...forbidden
        }),
      /Sensitive context is forbidden/
    );
  }

  const item = queue.enqueue({
    shopId: "demo-shop",
    requestId: "request-id",
    reviewSafety: new ContentSafety().sanitizeReviewReply(
      "safe reply",
      "unrelated buyer question"
    ),
    confidence: 0.9
  });
  assert.deepEqual(Object.keys(item), [
    "id",
    "shop_id",
    "request_id",
    "ai_reply",
    "confidence",
    "status"
  ]);
});

test("RC1.5 vectorStore throws on cross-shop namespace access", () => {
  const store = new LocalVectorStore();
  const shopA = tenant("shop-a");
  store.addDocument(
    shopA,
    {
      title: "FAQ",
      sourceType: "faq",
      content: "Static FAQ for shop A"
    }
  );

  assert.throws(
    () => store.search("shop-a", "FAQ"),
    /Forbidden tenant access/
  );
  assert.throws(
    () => store.search(
      {
        shopId: "shop-a",
        tenantId: "shop-a",
        apiKeyHash: "fake",
        resolvedBy: "auth"
      },
      "FAQ"
    ),
    /Forbidden tenant access/
  );
  assert.throws(
    () => store.listDocuments(shopA, "shop-b"),
    /Forbidden tenant access/
  );
  assert.equal(store.search(shopA, "FAQ").length, 1);
});

test("RC1.5 policyClassifier blocks high-risk input without LLM", async () => {
  let providerCalls = 0;
  const app = createApp({
    provider: {
      async generate() {
        providerCalls += 1;
        return safeProvider();
      }
    }
  });
  const response = await authenticated(
    request(app)
      .post("/api/v1/chat/preview")
      .send({ buyerMessage: "Please delete my order" })
  ).expect(200);

  assert.equal(response.body.status, "NEEDS_HUMAN");
  assert.equal(providerCalls, 0);
});

test("RC1.5 response post-check overrides an unsafe model reply", async () => {
  const app = createApp({
    provider: safeProvider({
      reply: "We will refund amount 100 and mark the order shipped."
    })
  });
  const response = await authenticated(
    request(app)
      .post("/api/v1/chat/preview")
      .send({ buyerMessage: "Explain the general support policy" })
  ).expect(200);

  assert.equal(response.body.status, "NEEDS_HUMAN");
  assert.equal(response.body.reply, HUMAN_HANDOFF_REPLY);
  assert.equal(
    app.locals.services.reviewQueue.list({ shopId: "demo-shop" }).length,
    0
  );
});

test("RC1.5 protected route enforces the immutable middleware order", async () => {
  const observed = [];
  const app = createApp({
    provider: safeProvider(),
    pipelineObserver: (steps) => observed.push(steps)
  });

  await authenticated(
    request(app)
      .post("/api/v1/chat/preview")
      .send({ buyerMessage: "Explain the general FAQ" })
  ).expect(200);

  assert.deepEqual(observed[0], SECURITY_PIPELINE_ORDER);
});

test("RC1.5 authentication runs before JSON parsing", async () => {
  const app = createApp();
  const response = await request(app)
    .post("/api/v1/chat/preview")
    .set("Content-Type", "application/json")
    .send('{"buyerMessage":')
    .expect(401);
  assert.equal(response.body.code, "AUTH_INVALID_API_KEY");
});

test("RC1.5 request hard timeout returns the safe fallback", async () => {
  const app = createApp({
    requestTimeout: createRequestTimeout({ timeoutMs: 20 }),
    provider: {
      async generate({ signal }) {
        await new Promise((resolve) => {
          signal.addEventListener("abort", resolve, { once: true });
        });
        return {
          reply: "",
          confidence: 0,
          needsHuman: true,
          tokenUsage: {},
          errorCode: "REQUEST_ABORTED"
        };
      }
    }
  });

  const response = await authenticated(
    request(app)
      .post("/api/v1/chat/preview")
      .send({ buyerMessage: "Explain the general FAQ" })
  ).expect(503);
  assert.equal(response.body.status, "NEEDS_HUMAN");
  assert.equal(response.body.reply, HUMAN_HANDOFF_REPLY);
});

test("RC1.5 global error boundary returns the safe fallback", async () => {
  const app = createApp({
    vectorStore: {
      addDocument() {
        throw new Error("private internal failure");
      },
      listDocuments() {
        return [];
      },
      deleteDocument() {
        return false;
      },
      search() {
        return [];
      }
    }
  });

  const response = await authenticated(
    request(app).post("/api/v1/kb/documents").send({
      title: "FAQ",
      sourceType: "faq",
      content: "Static merchant FAQ"
    })
  ).expect(500);
  assert.equal(response.body.status, "NEEDS_HUMAN");
  assert.equal(response.body.reply, HUMAN_HANDOFF_REPLY);
  assert.equal(JSON.stringify(response.body).includes("private internal failure"), false);
});

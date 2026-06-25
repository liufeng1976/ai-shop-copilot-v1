import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/server.js";
import { SqliteDatabase } from "../src/services/database.js";
import { LocalVectorStore } from "../src/services/vectorStore.js";
import { ReviewQueue } from "../src/services/reviewQueue.js";
import { ContentSafety } from "../src/services/contentSafety.js";
import {
  AuthService,
  DEMO_API_KEY_HASH,
  createAuthenticatedTenantContext
} from "../src/services/authService.js";
import { signWebhookPayload } from "../src/services/webhookSecurity.js";
import { WebhookSecurity } from "../src/services/webhookSecurity.js";

const API_KEY = "demo-secret-key";

function tempDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "ai-shop-copilot-"));
  return {
    directory,
    filename: join(directory, "app.sqlite")
  };
}

function tenant(shopId = "demo-shop") {
  return createAuthenticatedTenantContext({
    shopId,
    apiKeyId: `hash-${shopId}`
  });
}

function reviewSafety(reply = "safe reply") {
  return new ContentSafety().sanitizeReviewReply(reply, "unrelated buyer question");
}

test("SQLite persists KB and review records across service instances", () => {
  const { directory, filename } = tempDatabasePath();
  try {
    const db1 = new SqliteDatabase({ filename });
    const store1 = new LocalVectorStore({ database: db1 });
    const queue1 = new ReviewQueue({ database: db1 });
    const context = tenant();

    const doc = store1.addDocument(context, {
      title: "Static FAQ",
      sourceType: "faq",
      content: "Static merchant return policy"
    });
    const review = queue1.enqueue({
      shopId: "demo-shop",
      requestId: "persist-review",
      reviewSafety: reviewSafety(),
      confidence: 0.8
    });
    db1.close();

    const db2 = new SqliteDatabase({ filename });
    const store2 = new LocalVectorStore({ database: db2 });
    const queue2 = new ReviewQueue({ database: db2 });

    assert.equal(store2.listDocuments(context).at(0).id, doc.id);
    assert.equal(queue2.list({ shopId: "demo-shop" }).at(0).id, review.id);
    db2.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("AuthService stores API key hashes instead of plaintext secrets", () => {
  const authService = new AuthService([
    { apiKeyHash: DEMO_API_KEY_HASH, shopId: "demo-shop" }
  ]);

  assert.equal(authService.authenticate(API_KEY).shopId, "demo-shop");
  assert.equal(JSON.stringify(authService.merchants).includes(API_KEY), false);
  assert.equal(Buffer.isBuffer(authService.merchants[0].apiKeyHash), true);
});

test("chat preview requestId is idempotent and does not re-call LLM", async () => {
  let calls = 0;
  const provider = {
    async generate() {
      calls += 1;
      return {
        reply: "根据静态资料，可以这样回复。",
        confidence: 0.95,
        needsHuman: false,
        tokenUsage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      };
    }
  };
  const app = createApp({
    provider,
    shopConfigs: { "demo-shop": { reviewMode: "AUTO", threshold: 0.9 } }
  });

  await request(app)
    .post("/api/v1/kb/documents")
    .set("X-API-Key", API_KEY)
    .send({
      title: "FAQ",
      sourceType: "faq",
      content: "Static merchant warranty FAQ"
    })
    .expect(201);

  const body = {
    requestId: "idem-chat-1",
    buyerMessage: "warranty FAQ"
  };
  const first = await request(app)
    .post("/api/v1/chat/preview")
    .set("X-API-Key", API_KEY)
    .send(body)
    .expect(200);
  const second = await request(app)
    .post("/api/v1/chat/preview")
    .set("X-API-Key", API_KEY)
    .send({ ...body, buyerMessage: "different safe question" })
    .expect(200);

  assert.equal(calls, 1);
  assert.equal(first.body.status, "SEND_READY");
  assert.equal(second.body.duplicate, true);
  assert.equal(JSON.stringify(app.locals.services.idempotencyStore.snapshot()).includes("idem-chat-1"), false);
});

test("webhook signature, timestamp and replay protection are enforced", async () => {
  const secret = "test-webhook-secret";
  const app = createApp({
    webhookSecurity: undefined
  });
  app.locals.services.webhookSecurity.secret = secret;
  const timestamp = Date.now();
  const payload = JSON.stringify({ platformMessageId: "pm-1" });
  const signature = signWebhookPayload({ secret, timestamp, body: payload });

  await request(app)
    .post("/api/v1/webhooks/mock")
    .set("X-API-Key", API_KEY)
    .set("Content-Type", "application/json")
    .set("X-Webhook-Timestamp", String(timestamp))
    .set("X-Webhook-Signature", signature)
    .set("X-Webhook-Nonce", "nonce-1")
    .send(payload)
    .expect(200);

  await request(app)
    .post("/api/v1/webhooks/mock")
    .set("X-API-Key", API_KEY)
    .set("Content-Type", "application/json")
    .set("X-Webhook-Timestamp", String(timestamp))
    .set("X-Webhook-Signature", signature)
    .set("X-Webhook-Nonce", "nonce-1")
    .send(payload)
    .expect(401)
    .expect(({ body }) => assert.equal(body.code, "WEBHOOK_REPLAY_DETECTED"));

  await request(app)
    .post("/api/v1/webhooks/mock")
    .set("X-API-Key", API_KEY)
    .set("Content-Type", "application/json")
    .set("X-Webhook-Timestamp", String(Date.now() - 10 * 60 * 1000))
    .set("X-Webhook-Signature", signature)
    .set("X-Webhook-Nonce", "nonce-2")
    .send(payload)
    .expect(401)
    .expect(({ body }) => assert.equal(body.code, "WEBHOOK_TIMESTAMP_EXPIRED"));
});

test("production rejects the default webhook secret", () => {
  const database = new SqliteDatabase();
  assert.throws(
    () => new WebhookSecurity({ database, nodeEnv: "production" }),
    /default webhook secret is forbidden/
  );
  database.close();
});

test("webhook platformMessageId is idempotent after signature verification", async () => {
  const secret = "test-webhook-secret";
  const app = createApp();
  app.locals.services.webhookSecurity.secret = secret;

  function sendSigned(nonce, platformMessageId) {
    const timestamp = Date.now();
    const payload = JSON.stringify({ platformMessageId });
    const signature = signWebhookPayload({ secret, timestamp, body: payload });
    return request(app)
      .post("/api/v1/webhooks/mock")
      .set("X-API-Key", API_KEY)
      .set("Content-Type", "application/json")
      .set("X-Webhook-Timestamp", String(timestamp))
      .set("X-Webhook-Signature", signature)
      .set("X-Webhook-Nonce", nonce)
      .send(payload);
  }

  const first = await sendSigned("nonce-idem-1", "pm-idem").expect(200);
  const second = await sendSigned("nonce-idem-2", "pm-idem").expect(200);

  assert.equal(first.body.status, "ACCEPTED");
  assert.equal(second.body.duplicate, true);
  assert.equal(JSON.stringify(app.locals.services.idempotencyStore.snapshot()).includes("pm-idem"), false);
});

test("metrics expose error, LLM failure and human handoff rates without user text", async () => {
  const provider = {
    async generate() {
      return {
        reply: "",
        confidence: 0,
        needsHuman: true,
        errorCode: "LLM_INVALID_RESPONSE",
        tokenUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
    }
  };
  const app = createApp({
    provider,
    shopConfigs: { "demo-shop": { reviewMode: "AUTO", threshold: 0.9 } }
  });

  await request(app)
    .post("/api/v1/kb/documents")
    .set("X-API-Key", API_KEY)
    .send({
      title: "FAQ",
      sourceType: "faq",
      content: "Static merchant warranty FAQ"
    })
    .expect(201);

  await request(app)
    .post("/api/v1/chat/preview")
    .set("X-API-Key", API_KEY)
    .send({
      requestId: "metrics-1",
      buyerMessage: "warranty FAQ"
    })
    .expect(200);

  const response = await request(app)
    .get("/api/v1/metrics")
    .set("X-API-Key", API_KEY)
    .expect(200);

  assert.equal(response.body.metrics.request_total, 1);
  assert.equal(response.body.metrics.llm_failure_total, 1);
  assert.equal(response.body.metrics.human_handoff_total, 1);
  assert.equal(JSON.stringify(response.body).includes("warranty FAQ"), false);
});

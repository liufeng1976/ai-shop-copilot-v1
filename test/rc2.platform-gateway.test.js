import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/server.js";
import { signWebhookPayload } from "../src/services/webhookSecurity.js";
import { IdempotencyStore } from "../src/services/idempotencyStore.js";
import { OAuthStateStore } from "../src/services/oauthStateStore.js";

const API_KEY = "demo-secret-key";
const WEBHOOK_SECRET = "local-webhook-secret";

function providerResult() {
  let calls = 0;
  return {
    provider: {
      async generate() {
        calls += 1;
        return {
          reply: "根据静态商家知识，可以由客服审核后回复。",
          confidence: 0.95,
          needsHuman: false,
          tokenUsage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        };
      }
    },
    get calls() {
      return calls;
    }
  };
}

function signPayload(payload, { timestamp = Date.now(), secret = WEBHOOK_SECRET } = {}) {
  const body = JSON.stringify(payload);
  return {
    body,
    timestamp,
    signature: signWebhookPayload({ secret, timestamp, body })
  };
}

function signedWebhook(app, platform, payload, options = {}) {
  const signed = signPayload(payload, options);
  return request(app)
    .post(`/api/v1/webhooks/${platform}/messages`)
    .set("X-API-Key", API_KEY)
    .set("Content-Type", "application/json")
    .set("X-Webhook-Timestamp", String(signed.timestamp))
    .set("X-Webhook-Signature", options.signature ?? signed.signature)
    .set("X-Webhook-Nonce", options.nonce ?? `nonce-${payload.platformMessageId}`)
    .send(signed.body);
}

async function seedKnowledge(app) {
  await request(app)
    .post("/api/v1/kb/documents")
    .set("X-API-Key", API_KEY)
    .send({
      title: "FAQ",
      sourceType: "faq",
      content: "Static merchant FAQ for platform gateway"
    })
    .expect(201);
}

test("RC2 unconfigured real platform webhook returns 503", async () => {
  const app = createApp();
  await signedWebhook(app, "douyin", {
    platformMessageId: "dy-1",
    conversationId: "c-1",
    messageText: "safe question",
    senderRole: "buyer"
  })
    .expect(503)
    .expect(({ body }) => assert.equal(body.code, "PLATFORM_NOT_CONFIGURED"));
});

test("RC2 invalid webhook signature is rejected", async () => {
  const app = createApp();
  await signedWebhook(
    app,
    "manual",
    {
      platformMessageId: "m-1",
      conversationId: "c-1",
      messageText: "safe question",
      senderRole: "buyer"
    },
    { signature: "0".repeat(64) }
  )
    .expect(401)
    .expect(({ body }) => assert.equal(body.code, "WEBHOOK_BAD_SIGNATURE"));
});

test("RC2 expired webhook timestamp is rejected", async () => {
  const app = createApp();
  await signedWebhook(
    app,
    "manual",
    {
      platformMessageId: "m-2",
      conversationId: "c-1",
      messageText: "safe question",
      senderRole: "buyer"
    },
    { timestamp: Date.now() - 10 * 60 * 1000 }
  )
    .expect(401)
    .expect(({ body }) => assert.equal(body.code, "WEBHOOK_TIMESTAMP_EXPIRED"));
});

test("RC2 duplicate platformMessageId does not call LLM twice", async () => {
  const provider = providerResult();
  const app = createApp({
    provider: provider.provider,
    shopConfigs: { "demo-shop": { reviewMode: "AUTO", threshold: 0.9 } }
  });
  await seedKnowledge(app);
  const payload = {
    platformMessageId: "pm-dup",
    conversationId: "c-dup",
    messageText: "product size guide",
    senderRole: "buyer"
  };

  await signedWebhook(app, "manual", payload, { nonce: "nonce-dup-1" })
    .expect(200)
    .expect(({ body }) => assert.equal(body.duplicate, false));
  await signedWebhook(app, "manual", payload, { nonce: "nonce-dup-2" })
    .expect(200)
    .expect(({ body }) => assert.equal(body.duplicate, true));

  assert.equal(provider.calls, 1);
});

test("RC2 body shopId cannot spoof webhook tenant", async () => {
  const app = createApp();
  await signedWebhook(app, "manual", {
    shopId: "victim-shop",
    platformMessageId: "spoof-1",
    conversationId: "c-1",
    messageText: "safe question",
    senderRole: "buyer"
  })
    .expect(403)
    .expect(({ body }) => assert.equal(body.code, "CLIENT_SHOP_ID_FORBIDDEN"));
});

test("RC2 unapproved review cannot be sent", async () => {
  const app = createApp({ provider: providerResult().provider });
  await seedKnowledge(app);
  await request(app)
    .post("/api/v1/chat/preview")
    .set("X-API-Key", API_KEY)
    .send({ buyerMessage: "product size guide" })
    .expect(200);
  const [review] = app.locals.services.reviewQueue.list({ shopId: "demo-shop" });

  await request(app)
    .post(`/api/v1/reviews/${review.id}/send`)
    .set("X-API-Key", API_KEY)
    .send({
      platform: "manual",
      conversationId: "conv-1",
      platformMessageId: "pm-review",
      approvedBy: "human-reviewer"
    })
    .expect(409)
    .expect(({ body }) => assert.equal(body.code, "REVIEW_NOT_APPROVED"));
});

test("RC2 approved review builds ReplyCommand without buyerMessage", async () => {
  const app = createApp({ provider: providerResult().provider });
  await seedKnowledge(app);
  await request(app)
    .post("/api/v1/chat/preview")
    .set("X-API-Key", API_KEY)
    .send({ buyerMessage: "unique buyer message must not appear" })
    .expect(200);
  const [review] = app.locals.services.reviewQueue.list({ shopId: "demo-shop" });
  await request(app)
    .post(`/api/v1/reviews/${review.id}/approve`)
    .set("X-API-Key", API_KEY)
    .expect(200);

  const response = await request(app)
    .post(`/api/v1/reviews/${review.id}/send`)
    .set("X-API-Key", API_KEY)
    .send({
      platform: "manual",
      conversationId: "conv-1",
      platformMessageId: "pm-review",
      approvedBy: "human-reviewer"
    })
    .expect(200);

  assert.equal(response.body.command.approvedBy, "human-reviewer");
  assert.equal(response.body.receipt.sent, false);
  assert.equal(JSON.stringify(response.body.command).includes("unique buyer message"), false);
  assert.equal(Object.hasOwn(response.body.command, "buyerMessage"), false);
});

test("RC2 unconfigured adapter cannot fake send success", async () => {
  const app = createApp({ provider: providerResult().provider });
  await seedKnowledge(app);
  await request(app)
    .post("/api/v1/chat/preview")
    .set("X-API-Key", API_KEY)
    .send({ buyerMessage: "product size guide" })
    .expect(200);
  const [review] = app.locals.services.reviewQueue.list({ shopId: "demo-shop" });
  await request(app)
    .post(`/api/v1/reviews/${review.id}/approve`)
    .set("X-API-Key", API_KEY)
    .expect(200);

  await request(app)
    .post(`/api/v1/reviews/${review.id}/send`)
    .set("X-API-Key", API_KEY)
    .send({
      platform: "douyin",
      conversationId: "conv-1",
      platformMessageId: "pm-review",
      approvedBy: "human-reviewer"
    })
    .expect(503)
    .expect(({ body }) => assert.equal(body.code, "PLATFORM_NOT_CONFIGURED"));
});

test("RC2 OAuth state missing or expired is rejected", async () => {
  let now = Date.now();
  const idempotencyStore = new IdempotencyStore({ now: () => now });
  const oauthStateStore = new OAuthStateStore({ idempotencyStore, ttlMs: 100 });
  const app = createApp({ idempotencyStore, oauthStateStore });

  await request(app)
    .get("/api/v1/integrations/manual/callback?code=abc")
    .set("X-API-Key", API_KEY)
    .expect(400)
    .expect(({ body }) => assert.equal(body.code, "OAUTH_STATE_REQUIRED"));

  const authorize = await request(app)
    .get("/api/v1/integrations/manual/authorize")
    .set("X-API-Key", API_KEY)
    .expect(200);
  now += 101;

  await request(app)
    .get(`/api/v1/integrations/manual/callback?code=abc&state=${authorize.body.state}`)
    .set("X-API-Key", API_KEY)
    .expect(400)
    .expect(({ body }) => assert.equal(body.code, "OAUTH_STATE_INVALID"));
});

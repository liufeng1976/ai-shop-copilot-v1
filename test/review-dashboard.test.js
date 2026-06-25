import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/server.js";
import { COMMERCE_INTENTS } from "../src/services/commerceIntentClassifier.js";
import { ContentSafety } from "../src/services/contentSafety.js";
import { signWebhookPayload } from "../src/services/webhookSecurity.js";

const API_KEY = "demo-secret-key";
const WEBHOOK_SECRET = "local-webhook-secret";

function safeReview(reply) {
  return new ContentSafety().sanitizeReviewReply(reply, "private buyer text");
}

function enqueueReview(app, {
  requestId,
  intent,
  riskLevel = "LOW",
  reply = `safe dashboard draft ${requestId}`
}) {
  return app.locals.services.reviewQueue.enqueue({
    shopId: "demo-shop",
    requestId,
    reviewSafety: safeReview(reply),
    confidence: 0.7,
    intent,
    riskLevel
  });
}

function providerResult(reply = "safe presale draft") {
  return {
    async generate() {
      return {
        reply,
        confidence: 0.95,
        needsHuman: false,
        tokenUsage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        errorCode: null
      };
    }
  };
}

function signedWebhook(app, payload, { timestamp = Date.now(), nonce } = {}) {
  const body = JSON.stringify(payload);
  const signature = signWebhookPayload({
    secret: WEBHOOK_SECRET,
    timestamp,
    body
  });
  return request(app)
    .post("/api/v1/webhooks/manual/messages")
    .set("X-API-Key", API_KEY)
    .set("Content-Type", "application/json")
    .set("X-Webhook-Timestamp", String(timestamp))
    .set("X-Webhook-Signature", signature)
    .set("X-Webhook-Nonce", nonce ?? `nonce-${payload.platformMessageId}`)
    .send(body);
}

test("stage 4 review list filters by status", async () => {
  const app = createApp();
  const pending = enqueueReview(app, {
    requestId: "pending-review",
    intent: COMMERCE_INTENTS.PRE_SALE
  });
  const approved = enqueueReview(app, {
    requestId: "approved-review",
    intent: COMMERCE_INTENTS.AFTER_SALE,
    riskLevel: "MEDIUM"
  });
  app.locals.services.reviewQueue.approve("demo-shop", approved.id);

  const response = await request(app)
    .get("/api/v1/reviews?status=PENDING")
    .set("X-API-Key", API_KEY)
    .expect(200);

  assert.deepEqual(response.body.items.map((item) => item.id), [pending.id]);
  assert.equal(response.body.items[0].status, "PENDING");
});

test("stage 4 review list filters by priority", async () => {
  const app = createApp();
  enqueueReview(app, {
    requestId: "low-review",
    intent: COMMERCE_INTENTS.PRE_SALE
  });
  const high = enqueueReview(app, {
    requestId: "high-review",
    intent: COMMERCE_INTENTS.ORDER_SENSITIVE,
    riskLevel: "HIGH"
  });

  const response = await request(app)
    .get("/api/v1/reviews?priority=HIGH")
    .set("X-API-Key", API_KEY)
    .expect(200);

  assert.deepEqual(response.body.items.map((item) => item.id), [high.id]);
  assert.equal(response.body.items[0].priority, "HIGH");
});

test("stage 4 review list defaults to priority then created_at sorting", async () => {
  const app = createApp();
  enqueueReview(app, {
    requestId: "low-review",
    intent: COMMERCE_INTENTS.UNKNOWN
  });
  enqueueReview(app, {
    requestId: "medium-review",
    intent: COMMERCE_INTENTS.LOGISTICS,
    riskLevel: "MEDIUM"
  });
  enqueueReview(app, {
    requestId: "high-review",
    intent: COMMERCE_INTENTS.COMPLAINT_RISK,
    riskLevel: "MEDIUM"
  });

  const response = await request(app)
    .get("/api/v1/reviews")
    .set("X-API-Key", API_KEY)
    .expect(200);

  assert.deepEqual(
    response.body.items.map((item) => item.priority),
    ["HIGH", "MEDIUM", "LOW"]
  );
  assert.deepEqual(
    response.body.items.map((item) => item.request_id),
    ["high-review", "medium-review", "low-review"]
  );
});

test("stage 4 review summary returns pending counts by priority and intent", async () => {
  const app = createApp();
  enqueueReview(app, {
    requestId: "pending-high",
    intent: COMMERCE_INTENTS.FORBIDDEN_ACTION,
    riskLevel: "HIGH"
  });
  enqueueReview(app, {
    requestId: "pending-medium",
    intent: COMMERCE_INTENTS.AFTER_SALE,
    riskLevel: "MEDIUM"
  });
  enqueueReview(app, {
    requestId: "pending-low",
    intent: COMMERCE_INTENTS.PRE_SALE
  });
  const approved = enqueueReview(app, {
    requestId: "approved-high",
    intent: COMMERCE_INTENTS.ORDER_SENSITIVE,
    riskLevel: "HIGH"
  });
  app.locals.services.reviewQueue.approve("demo-shop", approved.id);

  const response = await request(app)
    .get("/api/v1/reviews/summary")
    .set("X-API-Key", API_KEY)
    .expect(200);

  assert.equal(response.body.summary.total_pending, 3);
  assert.equal(response.body.summary.high_priority_pending, 1);
  assert.equal(response.body.summary.medium_priority_pending, 1);
  assert.equal(response.body.summary.low_priority_pending, 1);
  assert.equal(response.body.summary.pending_by_intent.FORBIDDEN_ACTION, 1);
  assert.equal(response.body.summary.pending_by_intent.AFTER_SALE, 1);
  assert.equal(response.body.summary.pending_by_intent.PRE_SALE, 1);
  assert.equal(response.body.summary.pending_by_intent.ORDER_SENSITIVE, 0);
});

test("stage 4 dashboard APIs never expose sensitive fields or private text", async () => {
  const app = createApp();
  enqueueReview(app, {
    requestId: "privacy-review",
    intent: COMMERCE_INTENTS.ORDER_SENSITIVE,
    riskLevel: "HIGH",
    reply: "safe public draft"
  });

  const list = await request(app)
    .get("/api/v1/reviews")
    .set("X-API-Key", API_KEY)
    .expect(200);
  const summary = await request(app)
    .get("/api/v1/reviews/summary")
    .set("X-API-Key", API_KEY)
    .expect(200);

  const snapshot = JSON.stringify({ list: list.body, summary: summary.body });
  for (const forbidden of [
    "buyerMessage",
    "buyer_message",
    "prompt",
    "rawContext",
    "raw_context",
    "vectorContext",
    "vector_context",
    "kb_context",
    "private buyer text"
  ]) {
    assert.equal(snapshot.includes(forbidden), false);
  }
  assert.equal(list.body.items[0].intent, COMMERCE_INTENTS.ORDER_SENSITIVE);
  assert.equal(list.body.items[0].priority, "HIGH");
  assert.equal(typeof list.body.items[0].review_note, "string");
  assert.ok(list.body.items[0].review_note.length > 0);
});

test("stage 4 approve, send and SLA flow remains unchanged", async () => {
  const app = createApp({ provider: providerResult() });
  app.locals.services.platformAdapters.manual.sendReply = async (command) => ({
    ok: true,
    sent: true,
    command
  });

  const webhook = await signedWebhook(app, {
    platformMessageId: "dashboard-sla-1",
    conversationId: "conv-dashboard-sla-1",
    receivedAt: "2026-01-01T00:00:00.000Z",
    messageText: "product size guide private buyer input",
    senderRole: "buyer"
  }).expect(200);

  const [review] = app.locals.services.reviewQueue.list({ shopId: "demo-shop" });
  await request(app)
    .post(`/api/v1/reviews/${review.id}/approve`)
    .set("X-API-Key", API_KEY)
    .expect(200);

  await request(app)
    .post(`/api/v1/reviews/${review.id}/send`)
    .set("X-API-Key", API_KEY)
    .send({
      platform: "manual",
      conversationId: "conv-dashboard-sla-1",
      platformMessageId: "dashboard-sla-1",
      approvedBy: "human-agent"
    })
    .expect(200);

  const sla = app.locals.services.slaTracker.get(webhook.body.slaId);
  assert.equal(sla.status, "HUMAN_REPLIED");
  assert.equal(JSON.stringify(sla).includes("private buyer input"), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/server.js";
import { COMMERCE_INTENTS } from "../src/services/commerceIntentClassifier.js";
import { ContentSafety } from "../src/services/contentSafety.js";
import { priorityForIntent, ReviewQueue } from "../src/services/reviewQueue.js";
import { signWebhookPayload } from "../src/services/webhookSecurity.js";

const API_KEY = "demo-secret-key";
const WEBHOOK_SECRET = "local-webhook-secret";

function safeReview(reply = "安全审核草稿") {
  return new ContentSafety().sanitizeReviewReply(reply, "买家原文绝不应入队");
}

function enqueue(queue, { intent, requestId }) {
  return queue.enqueue({
    shopId: "demo-shop",
    requestId,
    reviewSafety: safeReview(`审核草稿 ${requestId}`),
    confidence: 0.6,
    intent,
    riskLevel: intent === COMMERCE_INTENTS.PRE_SALE ? "LOW" : "HIGH"
  });
}

function providerResult(reply = "售前客服草稿") {
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

test("stage 3 review priority is calculated from commerce intent", () => {
  assert.equal(priorityForIntent(COMMERCE_INTENTS.COMPLAINT_RISK), "HIGH");
  assert.equal(priorityForIntent(COMMERCE_INTENTS.FORBIDDEN_ACTION), "HIGH");
  assert.equal(priorityForIntent(COMMERCE_INTENTS.ORDER_SENSITIVE), "HIGH");
  assert.equal(priorityForIntent(COMMERCE_INTENTS.LOGISTICS), "MEDIUM");
  assert.equal(priorityForIntent(COMMERCE_INTENTS.AFTER_SALE), "MEDIUM");
  assert.equal(priorityForIntent(COMMERCE_INTENTS.PRE_SALE), "LOW");
  assert.equal(priorityForIntent(COMMERCE_INTENTS.UNKNOWN), "LOW");
});

test("stage 3 review list sorts HIGH before MEDIUM before LOW", () => {
  const queue = new ReviewQueue();
  enqueue(queue, { intent: COMMERCE_INTENTS.PRE_SALE, requestId: "low-1" });
  enqueue(queue, { intent: COMMERCE_INTENTS.LOGISTICS, requestId: "medium-1" });
  enqueue(queue, { intent: COMMERCE_INTENTS.COMPLAINT_RISK, requestId: "high-1" });

  const items = queue.list({ shopId: "demo-shop" });

  assert.deepEqual(
    items.map((item) => item.priority),
    ["HIGH", "MEDIUM", "LOW"]
  );
  assert.deepEqual(
    items.map((item) => item.request_id),
    ["high-1", "medium-1", "low-1"]
  );
});

test("stage 3 high-risk review notes are displayed without sensitive buyer text", () => {
  const queue = new ReviewQueue();
  enqueue(queue, { intent: COMMERCE_INTENTS.FORBIDDEN_ACTION, requestId: "forbidden" });
  enqueue(queue, { intent: COMMERCE_INTENTS.ORDER_SENSITIVE, requestId: "sensitive" });
  enqueue(queue, { intent: COMMERCE_INTENTS.COMPLAINT_RISK, requestId: "complaint" });

  const snapshot = JSON.stringify(queue.list({ shopId: "demo-shop" }));
  assert.match(snapshot, /禁止承诺 \/ 必须人工核实/);
  assert.match(snapshot, /订单\/支付\/地址\/手机号敏感信息 \/ 人工核实/);
  assert.match(snapshot, /投诉\/差评风险 \/ 优先处理/);
  assert.equal(snapshot.includes("买家原文绝不应入队"), false);
  assert.equal(snapshot.includes("buyerMessage"), false);
  assert.equal(snapshot.includes("prompt"), false);
});

test("stage 3 chat-created review carries non-sensitive intent metadata only", async () => {
  const provider = providerResult();
  const app = createApp({ provider: provider.provider });

  await request(app)
    .post("/api/v1/chat/preview")
    .set("X-API-Key", API_KEY)
    .send({ buyerMessage: "product size guide buyer secret phrase" })
    .expect(200);

  const [review] = app.locals.services.reviewQueue.list({ shopId: "demo-shop" });
  assert.equal(review.intent, COMMERCE_INTENTS.PRE_SALE);
  assert.equal(review.risk_level, "LOW");
  assert.equal(review.priority, "LOW");
  assert.equal(JSON.stringify(review).includes("buyer secret phrase"), false);
  assert.equal(provider.calls, 1);
});

test("stage 3 review priority does not affect SLA creation", async () => {
  const provider = providerResult();
  const app = createApp({ provider: provider.provider });
  const receivedAt = "2026-01-01T00:00:00.000Z";

  const response = await signedWebhook(app, {
    platformMessageId: "priority-sla-1",
    conversationId: "conv-priority-sla-1",
    receivedAt,
    messageText: "product size guide private text",
    senderRole: "buyer"
  }).expect(200);

  const sla = app.locals.services.slaTracker.get(response.body.slaId);
  const [review] = app.locals.services.reviewQueue.list({ shopId: "demo-shop" });
  assert.equal(sla.deadline_at, "2026-01-01T00:03:00.000Z");
  assert.equal(sla.status, "PENDING_REVIEW");
  assert.equal(review.priority, "LOW");
  assert.equal(JSON.stringify(sla).includes("private text"), false);
});

test("stage 3 approve and send flow still works with priority metadata", async () => {
  const provider = providerResult();
  const app = createApp({ provider: provider.provider });
  app.locals.services.platformAdapters.manual.sendReply = async (command) => ({
    ok: true,
    sent: true,
    command
  });

  await request(app)
    .post("/api/v1/chat/preview")
    .set("X-API-Key", API_KEY)
    .send({ buyerMessage: "product size guide" })
    .expect(200);

  const [review] = app.locals.services.reviewQueue.list({ shopId: "demo-shop" });
  assert.equal(review.priority, "LOW");

  await request(app)
    .post(`/api/v1/reviews/${review.id}/approve`)
    .set("X-API-Key", API_KEY)
    .expect(200);

  const sent = await request(app)
    .post(`/api/v1/reviews/${review.id}/send`)
    .set("X-API-Key", API_KEY)
    .send({
      platform: "manual",
      conversationId: "conv-review-priority",
      platformMessageId: "pm-review-priority",
      approvedBy: "human-agent"
    })
    .expect(200);

  assert.equal(sent.body.command.replyText, review.ai_reply);
  assert.equal(JSON.stringify(sent.body.command).includes("buyerMessage"), false);
});

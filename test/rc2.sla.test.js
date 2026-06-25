import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/server.js";
import { signWebhookPayload } from "../src/services/webhookSecurity.js";
import { FallbackReplyService, FALLBACK_REPLY } from "../src/services/fallbackReplyService.js";
import { SlaTracker, SLA_STATUSES } from "../src/services/slaTracker.js";
import { SlaWatcher } from "../src/services/slaWatcher.js";
import { EscalationService } from "../src/services/escalationService.js";

const API_KEY = "demo-secret-key";
const WEBHOOK_SECRET = "local-webhook-secret";

function providerCounter() {
  let calls = 0;
  return {
    provider: {
      async generate() {
        calls += 1;
        return {
          reply: "根据静态商家知识，请客服审核后回复。",
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

async function seedKnowledge(app) {
  await request(app)
    .post("/api/v1/kb/documents")
    .set("X-API-Key", API_KEY)
    .send({
      title: "FAQ",
      sourceType: "faq",
      content: "Static merchant FAQ for SLA"
    })
    .expect(201);
}

async function createSlaViaWebhook(app, {
  receivedAt = new Date("2026-01-01T00:00:00.000Z"),
  platformMessageId = "sla-1",
  messageText = "SLA buyer text must not persist"
} = {}) {
  await seedKnowledge(app);
  const response = await signedWebhook(app, {
    platformMessageId,
    conversationId: `conv-${platformMessageId}`,
    receivedAt: receivedAt.toISOString(),
    messageText,
    senderRole: "buyer"
  }).expect(200);
  return response.body.slaId;
}

test("RC2-B creates SLA deadlines at +90s, +150s and +180s", async () => {
  const app = createApp({ provider: providerCounter().provider });
  const receivedAt = new Date("2026-01-01T00:00:00.000Z");
  const slaId = await createSlaViaWebhook(app, { receivedAt });
  const record = app.locals.services.slaTracker.get(slaId);

  assert.equal(record.received_at, "2026-01-01T00:00:00.000Z");
  assert.equal(record.warn_at, "2026-01-01T00:01:30.000Z");
  assert.equal(record.fallback_at, "2026-01-01T00:02:30.000Z");
  assert.equal(record.deadline_at, "2026-01-01T00:03:00.000Z");
  assert.equal(JSON.stringify(record).includes("SLA buyer text"), false);
});

test("RC2-B sends fallback at 150 seconds without buyerMessage or LLM", async () => {
  const provider = providerCounter();
  const app = createApp({ provider: provider.provider });
  const sent = [];
  app.locals.services.platformAdapters.manual.sendReply = async (command) => {
    sent.push(command);
    return { ok: true, sent: true };
  };
  const slaId = await createSlaViaWebhook(app, {
    platformMessageId: "sla-fallback",
    messageText: "private buyer content"
  });
  assert.equal(provider.calls, 1);

  await app.locals.services.slaWatcher.scan({
    now: new Date("2026-01-01T00:02:30.000Z")
  });

  const record = app.locals.services.slaTracker.get(slaId);
  assert.equal(record.status, SLA_STATUSES.FALLBACK_REPLIED);
  assert.equal(record.first_reply_sent_at, "2026-01-01T00:02:30.000Z");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].replyText, FALLBACK_REPLY);
  assert.equal(JSON.stringify(sent[0]).includes("private buyer content"), false);
  assert.equal(provider.calls, 1);
});

test("RC2-B repeated watcher scan does not send duplicate fallback", async () => {
  const app = createApp({ provider: providerCounter().provider });
  let sends = 0;
  app.locals.services.platformAdapters.manual.sendReply = async () => {
    sends += 1;
    return { ok: true, sent: true };
  };
  await createSlaViaWebhook(app, { platformMessageId: "sla-repeat" });

  await app.locals.services.slaWatcher.scan({
    now: new Date("2026-01-01T00:02:30.000Z")
  });
  await app.locals.services.slaWatcher.scan({
    now: new Date("2026-01-01T00:02:40.000Z")
  });

  assert.equal(sends, 1);
});

test("RC2-B warning creates sanitized escalation event", async () => {
  const app = createApp({ provider: providerCounter().provider });
  const slaId = await createSlaViaWebhook(app, {
    platformMessageId: "sla-warn",
    messageText: "buyer secret"
  });

  await app.locals.services.slaWatcher.scan({
    now: new Date("2026-01-01T00:01:30.000Z")
  });

  const [event] = app.locals.services.escalationService.list();
  assert.equal(event.sla_id, slaId);
  assert.equal(event.severity, "WARN");
  assert.equal(JSON.stringify(event).includes("buyer secret"), false);
});

test("RC2-B approved review marks HUMAN_REPLIED", async () => {
  const app = createApp({ provider: providerCounter().provider });
  app.locals.services.platformAdapters.manual.sendReply = async () => ({
    ok: true,
    sent: true
  });
  const platformMessageId = "sla-human";
  const slaId = await createSlaViaWebhook(app, { platformMessageId });
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
      conversationId: `conv-${platformMessageId}`,
      platformMessageId,
      approvedBy: "human-agent"
    })
    .expect(200);

  const record = app.locals.services.slaTracker.get(slaId);
  assert.equal(record.status, SLA_STATUSES.HUMAN_REPLIED);
  assert.ok(record.first_reply_sent_at);
});

test("RC2-B human supplemental reply after fallback does not overwrite first reply time", async () => {
  const app = createApp({ provider: providerCounter().provider });
  app.locals.services.platformAdapters.manual.sendReply = async () => ({
    ok: true,
    sent: true
  });
  const platformMessageId = "sla-supplement";
  const slaId = await createSlaViaWebhook(app, { platformMessageId });
  await app.locals.services.slaWatcher.scan({
    now: new Date("2026-01-01T00:02:30.000Z")
  });
  const first = app.locals.services.slaTracker.get(slaId);
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
      conversationId: `conv-${platformMessageId}`,
      platformMessageId,
      approvedBy: "human-agent"
    })
    .expect(200);

  const after = app.locals.services.slaTracker.get(slaId);
  assert.equal(after.status, SLA_STATUSES.HUMAN_REPLIED);
  assert.equal(after.first_reply_sent_at, first.first_reply_sent_at);
});

test("RC2-B deadline exceeded without fallback marks EXPIRED", async () => {
  const tracker = new SlaTracker();
  const escalationService = new EscalationService();
  const watcher = new SlaWatcher({
    slaTracker: tracker,
    escalationService,
    fallbackReplyService: { async sendFallback() { return { ok: false }; } }
  });
  const record = tracker.createForMessage({
    shopId: "demo-shop",
    platform: "manual",
    platformMessageId: "sla-expire",
    conversationId: "conv-expire",
    receivedAt: "2026-01-01T00:00:00.000Z",
    messageText: "not stored",
    senderRole: "buyer",
    idempotencyKey: "manual:demo-shop:sla-expire"
  });

  await watcher.scan({ now: new Date("2026-01-01T00:03:00.000Z") });

  assert.equal(tracker.get(record.id).status, SLA_STATUSES.EXPIRED);
});

test("RC2-B SLA records never persist buyerMessage", async () => {
  const app = createApp({ provider: providerCounter().provider });
  await createSlaViaWebhook(app, {
    platformMessageId: "sla-privacy",
    messageText: "buyerMessage should never be stored"
  });

  assert.equal(
    JSON.stringify(app.locals.services.slaTracker.list()).includes("buyerMessage should never be stored"),
    false
  );
});

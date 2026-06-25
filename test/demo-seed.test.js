import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/server.js";
import { DEMO_SCENARIOS } from "../src/demo/demoScenarios.js";
import { COMMERCE_INTENTS } from "../src/services/commerceIntentClassifier.js";

const API_KEY = "demo-secret-key";

function providerResult(reply = "safe pre-sale demo draft") {
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

async function seedDemo(app, runId = "test-run") {
  const responses = [];
  for (const scenario of DEMO_SCENARIOS) {
    const response = await request(app)
      .post("/api/v1/chat/preview")
      .set("X-API-Key", API_KEY)
      .send({
        requestId: `${scenario.requestId}-${runId}`,
        buyerMessage: scenario.buyerMessage
      })
      .expect(200);
    responses.push(response.body);
  }
  return responses;
}

test("stage 5 demo seed generates review items for every commerce intent", async () => {
  const provider = providerResult();
  const app = createApp({ provider: provider.provider });

  const responses = await seedDemo(app, "intent");
  const reviews = app.locals.services.reviewQueue.list({ shopId: "demo-shop" });

  assert.deepEqual(
    responses.map((item) => item.intent),
    DEMO_SCENARIOS.map((scenario) => scenario.intent)
  );
  assert.deepEqual(
    new Set(reviews.map((item) => item.intent)),
    new Set(Object.values(COMMERCE_INTENTS))
  );
  assert.equal(reviews.length, DEMO_SCENARIOS.length);
  assert.equal(reviews.every((item) => item.status === "PENDING"), true);
  assert.equal(provider.calls, 1);
});

test("stage 5 demo summary counts and priority buckets are correct", async () => {
  const app = createApp({ provider: providerResult().provider });
  await seedDemo(app, "summary");

  const response = await request(app)
    .get("/api/v1/reviews/summary")
    .set("X-API-Key", API_KEY)
    .expect(200);

  assert.equal(response.body.summary.total_pending, 7);
  assert.equal(response.body.summary.high_priority_pending, 3);
  assert.equal(response.body.summary.medium_priority_pending, 2);
  assert.equal(response.body.summary.low_priority_pending, 2);
  for (const scenario of DEMO_SCENARIOS) {
    assert.equal(response.body.summary.pending_by_intent[scenario.intent], 1);
  }
});

test("stage 5 demo review list keeps priority ordering", async () => {
  const app = createApp({ provider: providerResult().provider });
  await seedDemo(app, "priority");

  const response = await request(app)
    .get("/api/v1/reviews")
    .set("X-API-Key", API_KEY)
    .expect(200);

  assert.deepEqual(
    response.body.items.map((item) => item.priority),
    ["HIGH", "HIGH", "HIGH", "MEDIUM", "MEDIUM", "LOW", "LOW"]
  );
  assert.deepEqual(
    response.body.items.slice(0, 3).map((item) => item.intent),
    [
      COMMERCE_INTENTS.COMPLAINT_RISK,
      COMMERCE_INTENTS.ORDER_SENSITIVE,
      COMMERCE_INTENTS.FORBIDDEN_ACTION
    ]
  );
});

test("stage 5 demo seed never persists buyerMessage text", async () => {
  const app = createApp({ provider: providerResult().provider });
  await seedDemo(app, "privacy");

  const reviewSnapshot = JSON.stringify(
    app.locals.services.reviewQueue.list({ shopId: "demo-shop" })
  );
  for (const scenario of DEMO_SCENARIOS) {
    assert.equal(reviewSnapshot.includes(scenario.buyerMessage), false);
  }
  assert.equal(reviewSnapshot.includes("buyerMessage"), false);
  assert.equal(reviewSnapshot.includes("rawContext"), false);
  assert.equal(reviewSnapshot.includes("vectorContext"), false);
  assert.equal(reviewSnapshot.includes("prompt"), false);
});

test("stage 5 demo approve and send stays on manual adapter without external platform calls", async () => {
  const app = createApp({ provider: providerResult().provider });
  let manualSends = 0;
  app.locals.services.platformAdapters.manual.sendReply = async (command) => {
    manualSends += 1;
    return {
      ok: true,
      sent: false,
      status: "MANUAL_DELIVERY_REQUIRED",
      command
    };
  };
  app.locals.services.platformAdapters.douyin.sendReply = async () => {
    throw new Error("real douyin adapter must not be called");
  };
  app.locals.services.platformAdapters.taobao.sendReply = async () => {
    throw new Error("real taobao adapter must not be called");
  };

  await seedDemo(app, "send");
  const [review] = app.locals.services.reviewQueue.list({
    shopId: "demo-shop",
    priority: "HIGH"
  });

  await request(app)
    .post(`/api/v1/reviews/${review.id}/approve`)
    .set("X-API-Key", API_KEY)
    .expect(200);

  const sent = await request(app)
    .post(`/api/v1/reviews/${review.id}/send`)
    .set("X-API-Key", API_KEY)
    .send({
      platform: "manual",
      conversationId: "demo-conversation",
      platformMessageId: "demo-platform-message",
      approvedBy: "demo-human-agent"
    })
    .expect(200);

  assert.equal(manualSends, 1);
  assert.equal(sent.body.receipt.sent, false);
  assert.equal(sent.body.receipt.status, "MANUAL_DELIVERY_REQUIRED");
  assert.equal(JSON.stringify(sent.body.command).includes("buyerMessage"), false);
});

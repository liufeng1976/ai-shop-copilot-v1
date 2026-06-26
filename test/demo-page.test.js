import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/server.js";
import { AuthService } from "../src/services/authService.js";

const API_KEY = "demo-secret-key";
const PROD_API_KEY = "prod-secret-key";

function providerResult(reply = "safe local demo draft") {
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

test("stage 6 demo page is accessible", async () => {
  const app = createApp();
  const response = await request(app).get("/demo").expect(200);

  assert.match(response.headers["content-type"], /html/);
  assert.match(response.text, /国内电商 AI 客服副驾驶 Demo/);
});

test("stage 6 demo page source does not include sensitive field names", async () => {
  const app = createApp();
  const response = await request(app).get("/demo").expect(200);

  for (const forbidden of [
    "buyerMessage",
    "buyer_message",
    "prompt",
    "rawContext",
    "raw_context",
    "vectorContext",
    "vector_context",
    "KB context",
    "kb_context"
  ]) {
    assert.equal(response.text.includes(forbidden), false);
  }
});

test("stage 6 demo seed endpoint generates summary for the page", async () => {
  const provider = providerResult();
  const app = createApp({ provider: provider.provider });

  const response = await request(app)
    .post("/api/v1/demo/seed")
    .set("X-API-Key", API_KEY)
    .send({ runId: "page-summary" })
    .expect(200);

  assert.equal(response.body.seeded.length, 7);
  assert.equal(response.body.summary.total_pending, 7);
  assert.equal(response.body.summary.high_priority_pending, 3);
  assert.equal(response.body.summary.medium_priority_pending, 2);
  assert.equal(response.body.summary.low_priority_pending, 2);
  assert.equal(response.body.highPriority.length, 3);
  assert.equal(provider.calls, 1);
});

test("stage 6 demo approve and send works through manual adapter with sent false", async () => {
  const app = createApp({ provider: providerResult().provider });
  let manualCalls = 0;
  app.locals.services.platformAdapters.manual.sendReply = async (command) => {
    manualCalls += 1;
    return {
      ok: true,
      sent: false,
      status: "MANUAL_DELIVERY_REQUIRED",
      command
    };
  };
  app.locals.services.platformAdapters.douyin.sendReply = async () => {
    throw new Error("external douyin adapter must not be called");
  };
  app.locals.services.platformAdapters.taobao.sendReply = async () => {
    throw new Error("external taobao adapter must not be called");
  };

  const seeded = await request(app)
    .post("/api/v1/demo/seed")
    .set("X-API-Key", API_KEY)
    .send({ runId: "page-send" })
    .expect(200);
  const review = seeded.body.highPriority[0];

  await request(app)
    .post(`/api/v1/reviews/${review.id}/approve`)
    .set("X-API-Key", API_KEY)
    .expect(200);

  const sent = await request(app)
    .post(`/api/v1/reviews/${review.id}/send`)
    .set("X-API-Key", API_KEY)
    .send({
      platform: "manual",
      conversationId: "demo-page-conversation",
      platformMessageId: "demo-page-message",
      approvedBy: "demo-human-agent"
    })
    .expect(200);

  assert.equal(manualCalls, 1);
  assert.equal(sent.body.receipt.sent, false);
  assert.equal(sent.body.receipt.status, "MANUAL_DELIVERY_REQUIRED");
  assert.equal(JSON.stringify(sent.body).includes("buyerMessage"), false);
});

test("stage 6 demo seed response does not expose private input text", async () => {
  const app = createApp({ provider: providerResult().provider });
  const response = await request(app)
    .post("/api/v1/demo/seed")
    .set("X-API-Key", API_KEY)
    .send({ runId: "page-privacy" })
    .expect(200);

  const snapshot = JSON.stringify(response.body);
  for (const forbidden of [
    "product size guide: which model should I choose?",
    "where is my package and when will it ship?",
    "what is your return and exchange policy?",
    "I am angry and will leave a bad review and complaint.",
    "please check my order status and update my phone number.",
    "please refund amount 100 yuan, change the price, and close the order.",
    "buyerMessage",
    "prompt",
    "rawContext",
    "vectorContext"
  ]) {
    assert.equal(snapshot.includes(forbidden), false);
  }
});

test("stage 7 development mode keeps demo page accessible", async () => {
  const app = createApp({ nodeEnv: "development" });
  await request(app).get("/demo").expect(200);
});

test("stage 7 production mode disables demo page and demo seed", async () => {
  const app = createApp({ nodeEnv: "production" });

  await request(app).get("/demo").expect(404);
  const response = await request(app)
    .post("/api/v1/demo/seed")
    .set("X-API-Key", API_KEY)
    .send({ runId: "prod-disabled" })
    .expect(404);

  assert.equal(response.body.code, "DEMO_DISABLED_IN_PRODUCTION");
});

test("stage 7 production demo guard does not affect health", async () => {
  const app = createApp({ nodeEnv: "production" });
  const response = await request(app).get("/health").expect(200);

  assert.equal(response.body.status, "ok");
});

test("stage 7 production demo guard does not affect chat and reviews", async () => {
  const authService = new AuthService(
    [{ apiKey: PROD_API_KEY, shopId: "prod-shop" }],
    { nodeEnv: "production" }
  );
  const app = createApp({
    authService,
    nodeEnv: "production",
    provider: providerResult().provider
  });

  await request(app)
    .post("/api/v1/chat/preview")
    .set("X-API-Key", PROD_API_KEY)
    .send({
      requestId: "prod-chat-preview",
      buyerMessage: "product size guide"
    })
    .expect(200);

  const reviews = await request(app)
    .get("/api/v1/reviews")
    .set("X-API-Key", PROD_API_KEY)
    .expect(200);

  assert.equal(reviews.body.items.length, 1);
  assert.equal(reviews.body.items[0].status, "PENDING");
});

test("stage 7 production demo guard keeps manual send as sent false", async () => {
  const authService = new AuthService(
    [{ apiKey: PROD_API_KEY, shopId: "prod-shop" }],
    { nodeEnv: "production" }
  );
  const app = createApp({
    authService,
    nodeEnv: "production",
    provider: providerResult().provider
  });
  let externalCalls = 0;
  app.locals.services.platformAdapters.manual.sendReply = async (command) => ({
    ok: true,
    sent: false,
    status: "MANUAL_DELIVERY_REQUIRED",
    command
  });
  app.locals.services.platformAdapters.douyin.sendReply = async () => {
    externalCalls += 1;
    throw new Error("external adapter must not be called");
  };
  app.locals.services.platformAdapters.taobao.sendReply = async () => {
    externalCalls += 1;
    throw new Error("external adapter must not be called");
  };

  await request(app)
    .post("/api/v1/chat/preview")
    .set("X-API-Key", PROD_API_KEY)
    .send({
      requestId: "prod-send-preview",
      buyerMessage: "product size guide"
    })
    .expect(200);
  const [review] = app.locals.services.reviewQueue.list({ shopId: "prod-shop" });

  await request(app)
    .post(`/api/v1/reviews/${review.id}/approve`)
    .set("X-API-Key", PROD_API_KEY)
    .expect(200);

  const sent = await request(app)
    .post(`/api/v1/reviews/${review.id}/send`)
    .set("X-API-Key", PROD_API_KEY)
    .send({
      platform: "manual",
      conversationId: "prod-demo-guard-conversation",
      platformMessageId: "prod-demo-guard-message",
      approvedBy: "prod-human-agent"
    })
    .expect(200);

  assert.equal(sent.body.receipt.sent, false);
  assert.equal(sent.body.receipt.status, "MANUAL_DELIVERY_REQUIRED");
  assert.equal(externalCalls, 0);
});

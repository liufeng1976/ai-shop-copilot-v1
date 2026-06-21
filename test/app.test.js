import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { LocalVectorStore } from "../src/local-vector-store.js";
import { ReviewQueue } from "../src/review-queue.js";

const TEST_CONFIG = {
  reviewApiKey: "test-review-secret",
  deepSeek: {}
};

function makeDependencies(reply = "请在 7 天内申请退货。") {
  const calls = [];
  const deepSeekClient = {
    async draftReply(input) {
      calls.push(input);
      return reply;
    }
  };
  const vectorStore = new LocalVectorStore([
    {
      id: "returns",
      title: "退货",
      content: "签收后七天内可申请退货。",
      tags: ["退货"]
    }
  ]);
  const reviewQueue = new ReviewQueue();
  return { calls, deepSeekClient, vectorStore, reviewQueue };
}

test("health endpoint reports the loaded static knowledge base", async () => {
  const dependencies = makeDependencies();
  const app = await createApp({ config: TEST_CONFIG, ...dependencies });

  const response = await request(app).get("/health").expect(200);
  assert.deepEqual(response.body, {
    status: "ok",
    knowledgeDocuments: 1
  });
});

test("chat preview retrieves knowledge and creates a pending review", async () => {
  const dependencies = makeDependencies();
  const app = await createApp({ config: TEST_CONFIG, ...dependencies });

  const response = await request(app)
    .post("/api/v1/chat/preview")
    .send({ buyerMessage: "这个商品可以退货吗？" })
    .expect(201);

  assert.equal(response.body.status, "pending");
  assert.equal(response.body.draftReply, "请在 7 天内申请退货。");
  assert.deepEqual(response.body.knowledgeRefs, ["returns"]);
  assert.equal(dependencies.calls.length, 1);
  assert.equal(dependencies.reviewQueue.list().length, 1);
});

test("review must be approved before mock sending", async () => {
  const dependencies = makeDependencies();
  const app = await createApp({ config: TEST_CONFIG, ...dependencies });
  const preview = await request(app)
    .post("/api/v1/chat/preview")
    .send({ buyerMessage: "如何退货？" })
    .expect(201);

  await request(app)
    .post(`/api/v1/reviews/${preview.body.reviewId}/send`)
    .set("x-review-api-key", TEST_CONFIG.reviewApiKey)
    .expect(409);

  await request(app)
    .post(`/api/v1/reviews/${preview.body.reviewId}/approve`)
    .set("x-review-api-key", TEST_CONFIG.reviewApiKey)
    .expect(200);

  const sent = await request(app)
    .post(`/api/v1/reviews/${preview.body.reviewId}/send`)
    .set("x-review-api-key", TEST_CONFIG.reviewApiKey)
    .expect(200);

  assert.equal(sent.body.review.status, "sent");
  assert.equal(sent.body.receipt.provider, "mock");
  assert.equal(sent.body.receipt.accepted, true);
});

test("invalid chat requests are rejected", async () => {
  const dependencies = makeDependencies();
  const app = await createApp({ config: TEST_CONFIG, ...dependencies });

  await request(app).post("/api/v1/chat/preview").send({}).expect(400);
  await request(app)
    .post("/api/v1/chat/preview")
    .send({ buyerMessage: "x".repeat(4001) })
    .expect(413);
});

test("review endpoints require reviewer authentication", async () => {
  const dependencies = makeDependencies();
  const app = await createApp({ config: TEST_CONFIG, ...dependencies });

  await request(app).get("/api/v1/reviews").expect(401);
  await request(app)
    .get("/api/v1/reviews")
    .set("x-review-api-key", TEST_CONFIG.reviewApiKey)
    .expect(200);
});

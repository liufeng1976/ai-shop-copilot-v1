import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { createApp } from "../src/server.js";
import { AuthService } from "../src/services/authService.js";
import { LocalVectorStore } from "../src/services/vectorStore.js";

const authService = () =>
  new AuthService([
    { apiKey: "key-a", shopId: "shop-a" },
    { apiKey: "key-b", shopId: "shop-b" }
  ]);

test("different shop_id partitions never cross-search", () => {
  const store = new LocalVectorStore();
  store.addDocument({
    shopId: "shop-a",
    title: "A 店退货",
    sourceType: "policy",
    content: "A 店支持七天退货。"
  });
  store.addDocument({
    shopId: "shop-b",
    title: "B 店保修",
    sourceType: "policy",
    content: "B 店提供两年保修。"
  });

  const results = store.search("shop-a", "两年保修 退货", 10);
  assert.equal(results.length, 1);
  assert.equal(results[0].shopId, "shop-a");
  assert.equal(results.some((document) => document.content.includes("两年保修")), false);
});

test("KB API cannot list or delete another tenant's documents", async () => {
  const app = createApp({ authService: authService() });
  const documentB = await request(app)
    .post("/api/v1/kb/documents")
    .set("X-API-Key", "key-b")
    .send({
      title: "B 店政策",
      sourceType: "policy",
      content: "B 店私有资料。"
    })
    .expect(201);

  const listA = await request(app)
    .get("/api/v1/kb/documents")
    .set("X-API-Key", "key-a")
    .expect(200);
  assert.equal(listA.body.items.length, 0);

  await request(app)
    .delete(`/api/v1/kb/documents/${documentB.body.id}`)
    .set("X-API-Key", "key-a")
    .expect(404);

  const listB = await request(app)
    .get("/api/v1/kb/documents")
    .set("X-API-Key", "key-b")
    .expect(200);
  assert.equal(listB.body.items.length, 1);
});

test("review API cannot query, approve or reject another tenant's reviews", async () => {
  const app = createApp({ authService: authService() });
  const review = app.locals.services.reviewQueue.enqueue({
    requestId: "request-b",
    shopId: "shop-b",
    reply: "B 店草稿",
    confidence: 0.8,
    knowledgeRefs: []
  });

  const listA = await request(app)
    .get("/api/v1/reviews")
    .set("X-API-Key", "key-a")
    .expect(200);
  assert.equal(listA.body.items.length, 0);

  await request(app)
    .post(`/api/v1/reviews/${review.id}/approve`)
    .set("X-API-Key", "key-a")
    .expect(404);
  await request(app)
    .post(`/api/v1/reviews/${review.id}/reject`)
    .set("X-API-Key", "key-a")
    .expect(404);

  const listB = await request(app)
    .get("/api/v1/reviews")
    .set("X-API-Key", "key-b")
    .expect(200);
  assert.equal(listB.body.items.length, 1);
  assert.equal(listB.body.items[0].status, "PENDING");
});

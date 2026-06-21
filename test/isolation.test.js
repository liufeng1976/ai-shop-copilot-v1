import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { createApp } from "../src/server.js";
import { LocalVectorStore } from "../src/services/vectorStore.js";

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

test("knowledge CRUD API keeps shop document listings isolated", async () => {
  const app = createApp();
  const created = await request(app)
    .post("/api/v1/kb/documents")
    .send({
      shopId: "demo-shop",
      title: "售后政策",
      sourceType: "policy",
      content: "本店支持签收后7天内无理由退货，商品需保持完好。"
    })
    .expect(201);

  await request(app)
    .post("/api/v1/kb/documents")
    .send({
      shopId: "other-shop",
      title: "其他店政策",
      sourceType: "policy",
      content: "其他店铺资料。"
    })
    .expect(201);

  const demo = await request(app)
    .get("/api/v1/kb/documents?shopId=demo-shop")
    .expect(200);
  assert.equal(demo.body.items.length, 1);
  assert.equal(demo.body.items[0].shopId, "demo-shop");

  await request(app)
    .delete(`/api/v1/kb/documents/${created.body.id}`)
    .expect(204);
  const empty = await request(app)
    .get("/api/v1/kb/documents?shopId=demo-shop")
    .expect(200);
  assert.equal(empty.body.items.length, 0);
});

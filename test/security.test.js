import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { createApp } from "../src/server.js";
import { createRateLimit } from "../src/middleware/rateLimit.js";

const API_KEY = "demo-secret-key";

test("missing or incorrect X-API-Key returns 401 on protected APIs", async () => {
  const app = createApp();
  for (const path of [
    "/api/v1/kb/documents",
    "/api/v1/reviews"
  ]) {
    await request(app).get(path).expect(401);
    await request(app).get(path).set("X-API-Key", "wrong-key").expect(401);
  }
  await request(app).post("/api/v1/chat/preview").send({ buyerMessage: "你好" }).expect(401);
});

test("body or query shopId mismatch returns 403", async () => {
  const app = createApp();
  await request(app)
    .post("/api/v1/chat/preview")
    .set("X-API-Key", API_KEY)
    .send({ shopId: "other-shop", buyerMessage: "你好" })
    .expect(403);
  await request(app)
    .get("/api/v1/kb/documents?shopId=other-shop")
    .set("X-API-Key", API_KEY)
    .expect(403);
  await request(app)
    .get("/api/v1/reviews?shopId=other-shop")
    .set("X-API-Key", API_KEY)
    .expect(403);
});

test("matching optional shopId is accepted but tenant still comes from API key", async () => {
  const app = createApp();
  const response = await request(app)
    .post("/api/v1/kb/documents")
    .set("X-API-Key", API_KEY)
    .send({
      shopId: "demo-shop",
      title: "FAQ",
      sourceType: "faq",
      content: "静态商家文档"
    })
    .expect(201);
  assert.equal(response.body.shopId, "demo-shop");
});

test("rate limit is enforced per apiKey and route", async () => {
  const app = createApp({
    rateLimit: createRateLimit({ limit: 2, windowMs: 60_000 })
  });
  for (let index = 0; index < 2; index += 1) {
    await request(app)
      .get("/api/v1/kb/documents")
      .set("X-API-Key", API_KEY)
      .expect(200);
  }
  const limited = await request(app)
    .get("/api/v1/kb/documents")
    .set("X-API-Key", API_KEY)
    .expect(429);
  assert.equal(limited.body.code, "RATE_LIMITED");

  await request(app)
    .get("/api/v1/reviews")
    .set("X-API-Key", API_KEY)
    .expect(200);
});

test("CORS allows configured origins and rejects unknown origins", async () => {
  const app = createApp();
  const allowed = await request(app)
    .get("/api/v1/kb/documents")
    .set("Origin", "http://localhost:5173")
    .set("X-API-Key", API_KEY)
    .expect(200);
  assert.equal(
    allowed.headers["access-control-allow-origin"],
    "http://localhost:5173"
  );

  const blocked = await request(app)
    .get("/api/v1/kb/documents")
    .set("Origin", "https://unknown.example")
    .set("X-API-Key", API_KEY)
    .expect(403);
  assert.equal(blocked.body.code, "CORS_ORIGIN_FORBIDDEN");
  assert.equal(blocked.headers["access-control-allow-origin"], undefined);
});

test("CORS never defaults to wildcard", async () => {
  const app = createApp();
  const response = await request(app)
    .get("/api/v1/kb/documents")
    .set("Origin", "http://localhost:3000")
    .set("X-API-Key", API_KEY)
    .expect(200);
  assert.notEqual(response.headers["access-control-allow-origin"], "*");
});

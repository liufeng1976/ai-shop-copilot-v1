import assert from "node:assert/strict";
import { test } from "node:test";
import { AuditLogger } from "../src/services/auditLogger.js";
import {
  createAuthenticatedTenantContext
} from "../src/services/authService.js";
import { ChatService } from "../src/services/chatService.js";
import {
  ContentSafety,
  REVIEW_REWRITE_REQUIRED
} from "../src/services/contentSafety.js";
import { ReviewQueue } from "../src/services/reviewQueue.js";
import {
  ForbiddenTenantAccessError,
  LocalVectorStore
} from "../src/services/vectorStore.js";

const tenant = (shopId = "demo-shop") =>
  createAuthenticatedTenantContext({
    shopId,
    apiKeyId: `test-hash-${shopId}`
  });

test("service-layer ChatService preview cannot bypass its internal pre-gate", async () => {
  let providerCalls = 0;
  const chatService = new ChatService({
    vectorStore: new LocalVectorStore(),
    provider: {
      async generate() {
        providerCalls += 1;
        throw new Error("LLM must not be called");
      }
    },
    reviewQueue: new ReviewQueue(),
    auditLogger: new AuditLogger(),
    contentSafety: new ContentSafety()
  });

  const result = await chatService.preview({
    tenantContext: tenant(),
    buyerMessage: "What is my refund status?"
  });

  assert.equal(result.status, "NEEDS_HUMAN");
  assert.equal(providerCalls, 0);
});

test("service-layer VectorStore requires an authenticated tenant context", () => {
  const store = new LocalVectorStore();
  const authenticatedTenant = tenant("shop-a");
  store.addDocument(authenticatedTenant, {
    title: "FAQ",
    sourceType: "faq",
    content: "Static shop A FAQ"
  });

  assert.throws(
    () => store.search("shop-a", "FAQ"),
    ForbiddenTenantAccessError
  );
  assert.throws(
    () =>
      store.addDocument("shop-a", {
        title: "Forged",
        sourceType: "faq",
        content: "Must not persist"
      }),
    ForbiddenTenantAccessError
  );
  assert.throws(
    () => store.listDocuments("shop-a"),
    ForbiddenTenantAccessError
  );
  assert.throws(
    () => store.deleteDocument("shop-a", "document-id"),
    ForbiddenTenantAccessError
  );
  assert.throws(
    () =>
      store.search(
        {
          shopId: "shop-a",
          tenantId: "shop-a",
          apiKeyHash: "forged",
          resolvedBy: "auth"
        },
        "FAQ"
      ),
    ForbiddenTenantAccessError
  );
  assert.equal(store.search(authenticatedTenant, "FAQ").length, 1);
});

test("review queue never stores an LLM echo of buyerMessage", async () => {
  const buyerMessage = "My unique support phrase blue-orchid-7842";
  const reviewQueue = new ReviewQueue();
  const chatService = new ChatService({
    vectorStore: new LocalVectorStore(),
    provider: {
      async generate() {
        return {
          reply: `You wrote: ${buyerMessage}`,
          confidence: 0.95,
          needsHuman: false,
          tokenUsage: {},
          errorCode: null
        };
      }
    },
    reviewQueue,
    auditLogger: new AuditLogger(),
    contentSafety: new ContentSafety()
  });

  const result = await chatService.preview({
    tenantContext: tenant(),
    buyerMessage
  });
  assert.equal(result.status, "PENDING_REVIEW");

  const [item] = reviewQueue.list({ shopId: "demo-shop" });
  assert.equal(item.ai_reply, REVIEW_REWRITE_REQUIRED);
  assert.equal(JSON.stringify(item).includes(buyerMessage), false);
  assert.equal(JSON.stringify(item).includes("blue-orchid-7842"), false);
});

test("ReviewQueue rejects an unverified ai_reply from direct callers", () => {
  const queue = new ReviewQueue();
  assert.throws(
    () =>
      queue.enqueue({
        shopId: "demo-shop",
        requestId: "request-id",
        reply: "arbitrary unverified reply",
        confidence: 0.9
      }),
    /Verified review-safe reply is required/
  );
});

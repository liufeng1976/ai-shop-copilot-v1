import express from "express";
import helmet from "helmet";
import { timingSafeEqual } from "node:crypto";
import { DeepSeekClient } from "./deepseek-client.js";
import { LocalVectorStore } from "./local-vector-store.js";
import { MockPlatformSender } from "./mock-platform-sender.js";
import { redactSensitiveText } from "./privacy.js";
import { ReviewQueue } from "./review-queue.js";

const DEFAULT_KNOWLEDGE_URL = new URL("../data/knowledge.json", import.meta.url);

export async function createApp({
  config,
  vectorStore,
  deepSeekClient,
  reviewQueue = new ReviewQueue(),
  platformSender = new MockPlatformSender()
} = {}) {
  if (!config?.reviewApiKey) {
    throw new Error("REVIEW_API_KEY is required");
  }

  const activeVectorStore =
    vectorStore ?? (await LocalVectorStore.fromJsonFile(DEFAULT_KNOWLEDGE_URL));
  const activeDeepSeekClient = deepSeekClient ?? new DeepSeekClient(config.deepSeek);

  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_request, response) => {
    response.json({
      status: "ok",
      knowledgeDocuments: activeVectorStore.size
    });
  });

  app.post("/api/v1/chat/preview", async (request, response, next) => {
    try {
      const { buyerMessage } = request.body ?? {};
      if (typeof buyerMessage !== "string" || buyerMessage.trim().length === 0) {
        return response.status(400).json({ error: "buyerMessage is required" });
      }
      if (buyerMessage.length > 4000) {
        return response.status(413).json({ error: "buyerMessage is too long" });
      }

      const knowledge = activeVectorStore.search(buyerMessage, 3);
      const rawDraft = await activeDeepSeekClient.draftReply({
        buyerMessage,
        knowledge
      });
      const draftReply = redactSensitiveText(rawDraft);
      const review = reviewQueue.enqueue({
        draftReply,
        knowledgeRefs: knowledge.map(({ id }) => id)
      });

      return response.status(201).json({
        reviewId: review.id,
        status: review.status,
        draftReply: review.draftReply,
        knowledgeRefs: review.knowledgeRefs,
        privacy: {
          persistedBuyerMessage: false,
          persistedOrderData: false,
          persistedCustomerData: false
        }
      });
    } catch (error) {
      return next(error);
    }
  });

  function requireReviewer(request, response, next) {
    const suppliedKey = request.get("x-review-api-key") ?? "";
    const expected = Buffer.from(config.reviewApiKey);
    const supplied = Buffer.from(suppliedKey);
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    ) {
      return response.status(401).json({ error: "Reviewer authentication required" });
    }
    return next();
  }

  app.get("/api/v1/reviews", requireReviewer, (_request, response) => {
    response.json({ items: reviewQueue.list() });
  });

  app.post("/api/v1/reviews/:id/approve", requireReviewer, (request, response, next) => {
    try {
      const item = reviewQueue.approve(request.params.id);
      if (!item) return response.status(404).json({ error: "Review not found" });
      return response.json(item);
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/v1/reviews/:id/send", requireReviewer, async (request, response, next) => {
    try {
      const item = reviewQueue.get(request.params.id);
      if (!item) return response.status(404).json({ error: "Review not found" });
      if (item.status !== "approved") {
        return response.status(409).json({ error: "Review must be approved before sending" });
      }

      const receipt = await platformSender.send({
        reviewId: item.id,
        message: item.draftReply
      });
      const updated = reviewQueue.markSent(item.id);
      return response.json({ review: updated, receipt });
    } catch (error) {
      return next(error);
    }
  });

  app.use((error, _request, response, _next) => {
    const status = error instanceof SyntaxError ? 400 : 500;
    response.status(status).json({
      error: status === 400 ? "Invalid JSON" : "Internal server error"
    });
  });

  app.locals.services = {
    vectorStore: activeVectorStore,
    reviewQueue,
    platformSender
  };
  return app;
}

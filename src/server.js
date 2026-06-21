import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { DeepSeekProvider } from "./services/deepseek.js";
import { LocalVectorStore } from "./services/vectorStore.js";
import { AuditLogger } from "./services/auditLogger.js";
import { ReviewQueue } from "./services/reviewQueue.js";
import { ChatService } from "./services/chatService.js";
import { MockPlatformAdapter } from "./adapters/mockPlatformAdapter.js";

export function createApp({
  vectorStore = new LocalVectorStore(),
  provider = new DeepSeekProvider(),
  auditLogger = new AuditLogger(),
  reviewQueue = new ReviewQueue(),
  platformAdapter = new MockPlatformAdapter(),
  shopConfigs
} = {}) {
  const chatService = new ChatService({
    vectorStore,
    provider,
    auditLogger,
    reviewQueue,
    shopConfigs
  });
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.post("/api/v1/kb/documents", (request, response, next) => {
    try {
      const document = vectorStore.addDocument(request.body ?? {});
      response.status(201).json(document);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/kb/documents", (request, response) => {
    if (!request.query.shopId) {
      return response.status(400).json({ error: "shopId is required" });
    }
    return response.json({
      items: vectorStore.listDocuments(request.query.shopId)
    });
  });

  app.delete("/api/v1/kb/documents/:id", (request, response) => {
    if (!vectorStore.deleteDocument(request.params.id)) {
      return response.status(404).json({ error: "Document not found" });
    }
    return response.status(204).send();
  });

  app.post("/api/v1/chat/preview", async (request, response, next) => {
    try {
      const { shopId, buyerMessage, requestId } = request.body ?? {};
      if (!shopId || typeof buyerMessage !== "string" || !buyerMessage.trim()) {
        return response.status(400).json({
          error: "shopId and buyerMessage are required"
        });
      }
      if (buyerMessage.length > 4000) {
        return response.status(413).json({ error: "buyerMessage is too long" });
      }
      const result = await chatService.preview({
        shopId,
        buyerMessage,
        requestId
      });
      return response.json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/v1/reviews", (request, response, next) => {
    try {
      if (!request.query.shopId) {
        return response.status(400).json({ error: "shopId is required" });
      }
      return response.json({
        items: reviewQueue.list({
          shopId: request.query.shopId,
          status: request.query.status
        })
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/v1/reviews/:id/approve", async (request, response, next) => {
    try {
      const review = reviewQueue.approve(request.params.id);
      if (!review) return response.status(404).json({ error: "Review not found" });
      const receipt = await platformAdapter.sendReply({
        shopId: review.shopId,
        reply: review.reply
      });
      return response.json({ review, receipt });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/v1/reviews/:id/reject", (request, response, next) => {
    try {
      const review = reviewQueue.reject(request.params.id);
      if (!review) return response.status(404).json({ error: "Review not found" });
      return response.json({ review });
    } catch (error) {
      return next(error);
    }
  });

  app.use((error, _request, response, _next) => {
    const isClientError = error instanceof TypeError || error instanceof SyntaxError;
    response.status(isClientError ? 400 : 500).json({
      error: isClientError ? error.message : "Internal server error"
    });
  });

  app.locals.services = {
    vectorStore,
    provider,
    auditLogger,
    reviewQueue,
    platformAdapter,
    chatService
  };
  return app;
}

const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => {
    console.log(`AI Shop Copilot listening on port ${port}`);
  });
}

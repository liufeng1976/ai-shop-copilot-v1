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
import { AuthService } from "./services/authService.js";
import { PolicyClassifier } from "./services/policyClassifier.js";
import { createRateLimit } from "./middleware/rateLimit.js";
import { MockPlatformAdapter } from "./adapters/mockPlatformAdapter.js";

const DEFAULT_CORS_ORIGINS = Object.freeze([
  "http://localhost:3000",
  "http://localhost:5173"
]);

function parseCorsOrigins(value = process.env.CORS_ORIGINS) {
  if (!value) return [...DEFAULT_CORS_ORIGINS];
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function createCorsMiddleware(allowedOrigins) {
  const whitelist = new Set(allowedOrigins);
  return (request, response, next) => {
    const origin = request.get("Origin");
    if (!origin) return next();
    if (!whitelist.has(origin)) {
      return response.status(403).json({
        error: "CORS origin forbidden",
        code: "CORS_ORIGIN_FORBIDDEN"
      });
    }
    response.set("Access-Control-Allow-Origin", origin);
    response.set("Vary", "Origin");
    response.set("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
    response.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    if (request.method === "OPTIONS") return response.status(204).send();
    return next();
  };
}

export function createApp({
  vectorStore = new LocalVectorStore(),
  provider = new DeepSeekProvider(),
  auditLogger = new AuditLogger(),
  reviewQueue = new ReviewQueue(),
  platformAdapter = new MockPlatformAdapter(),
  authService = new AuthService(),
  policyClassifier = new PolicyClassifier(),
  rateLimit = createRateLimit(),
  corsOrigins = parseCorsOrigins(),
  shopConfigs
} = {}) {
  const chatService = new ChatService({
    vectorStore,
    provider,
    auditLogger,
    reviewQueue,
    policyClassifier,
    shopConfigs
  });
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(createCorsMiddleware(corsOrigins));
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  const api = express.Router();
  api.use(authService.middleware());
  api.use(authService.enforceTenant());
  api.use(rateLimit);

  api.post("/kb/documents", (request, response, next) => {
    try {
      const document = vectorStore.addDocument({
        ...request.body,
        shopId: request.auth.shopId
      });
      response.status(201).json(document);
    } catch (error) {
      next(error);
    }
  });

  api.get("/kb/documents", (request, response) => {
    return response.json({
      items: vectorStore.listDocuments(request.auth.shopId)
    });
  });

  api.delete("/kb/documents/:id", (request, response) => {
    if (!vectorStore.deleteDocument(request.auth.shopId, request.params.id)) {
      return response.status(404).json({ error: "Document not found" });
    }
    return response.status(204).send();
  });

  api.post("/chat/preview", async (request, response, next) => {
    try {
      const { buyerMessage, requestId } = request.body ?? {};
      if (typeof buyerMessage !== "string" || !buyerMessage.trim()) {
        return response.status(400).json({ error: "buyerMessage is required" });
      }
      if (buyerMessage.length > 4000) {
        return response.status(413).json({ error: "buyerMessage is too long" });
      }
      const result = await chatService.preview({
        shopId: request.auth.shopId,
        buyerMessage,
        requestId
      });
      return response.json(result);
    } catch (error) {
      return next(error);
    }
  });

  api.get("/reviews", (request, response, next) => {
    try {
      return response.json({
        items: reviewQueue.list({
          shopId: request.auth.shopId,
          status: request.query.status
        })
      });
    } catch (error) {
      return next(error);
    }
  });

  api.post("/reviews/:id/approve", async (request, response, next) => {
    try {
      const review = reviewQueue.approve(request.auth.shopId, request.params.id);
      if (!review) return response.status(404).json({ error: "Review not found" });
      const receipt = await platformAdapter.sendReply({
        shopId: request.auth.shopId,
        reply: review.reply
      });
      return response.json({ review, receipt });
    } catch (error) {
      return next(error);
    }
  });

  api.post("/reviews/:id/reject", (request, response, next) => {
    try {
      const review = reviewQueue.reject(request.auth.shopId, request.params.id);
      if (!review) return response.status(404).json({ error: "Review not found" });
      return response.json({ review });
    } catch (error) {
      return next(error);
    }
  });

  app.use("/api/v1", api);

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
    authService,
    policyClassifier,
    chatService
  };
  return app;
}

const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => {
    console.log(`AI Shop Copilot RC1 listening on port ${port}`);
  });
}

export { DEFAULT_CORS_ORIGINS, parseCorsOrigins };

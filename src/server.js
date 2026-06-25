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
import { createAuthMiddleware } from "./middleware/authMiddleware.js";
import { createTenantResolver } from "./middleware/tenantResolver.js";
import { PolicyClassifier } from "./services/policyClassifier.js";
import { HUMAN_HANDOFF_REPLY } from "./services/policyClassifier.js";
import { ContentSafety } from "./services/contentSafety.js";
import { createContentSafetyGate } from "./middleware/contentSafetyGate.js";
import { createRateLimit } from "./middleware/rateLimit.js";
import {
  createRequestTimeout,
  REQUEST_TIMEOUT
} from "./middleware/requestTimeout.js";
import { MockPlatformAdapter } from "./adapters/mockPlatformAdapter.js";
import { DouyinAdapter } from "./adapters/douyinAdapter.js";
import { TaobaoAdapter } from "./adapters/taobaoAdapter.js";
import { ManualAdapter } from "./adapters/manualAdapter.js";
import { PlatformAdapter } from "./adapters/platformAdapter.js";
import { SqliteDatabase } from "./services/database.js";
import { IdempotencyStore } from "./services/idempotencyStore.js";
import { MetricsService } from "./services/metricsService.js";
import { WebhookSecurity } from "./services/webhookSecurity.js";
import { OAuthStateStore } from "./services/oauthStateStore.js";
import { createReplyCommand } from "./domain/replyCommand.js";
import { createWebhookSignatureMiddleware } from "./middleware/webhookSignature.js";
import { SlaTracker, SLA_STATUSES } from "./services/slaTracker.js";
import { SlaWatcher } from "./services/slaWatcher.js";
import { FallbackReplyService } from "./services/fallbackReplyService.js";
import { EscalationService } from "./services/escalationService.js";

const DEFAULT_CORS_ORIGINS = Object.freeze([
  "http://localhost:3000",
  "http://localhost:5173"
]);

const SECURITY_PIPELINE_ORDER = Object.freeze([
  "authMiddleware",
  "tenantResolver",
  "rateLimitMiddleware",
  "contentSafetyPreGate",
  "policyClassifier",
  "vectorStoreRetrieval",
  "deepseekGeneration",
  "responseSafetyPostCheck",
  "auditLogger"
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

function platformNotConfigured(response) {
  return response.status(503).json({
    error: "Platform not configured",
    code: "PLATFORM_NOT_CONFIGURED"
  });
}

function webhookRejected(response, code) {
  return response.status(401).json({
    error: "Webhook rejected",
    code
  });
}

export function createApp({
  database = new SqliteDatabase({
    filename: process.env.SQLITE_PATH ?? ":memory:"
  }),
  vectorStore = new LocalVectorStore({ database }),
  provider = new DeepSeekProvider(),
  auditLogger = new AuditLogger(),
  reviewQueue = new ReviewQueue({ database }),
  platformAdapter = new MockPlatformAdapter(),
  authService = new AuthService(),
  policyClassifier = new PolicyClassifier(),
  contentSafety = new ContentSafety(),
  idempotencyStore = new IdempotencyStore(),
  oauthStateStore = new OAuthStateStore({ idempotencyStore }),
  metricsService = new MetricsService(),
  webhookSecurity = new WebhookSecurity({ database }),
  platformAdapters,
  slaTracker = new SlaTracker({ database }),
  escalationService = new EscalationService(),
  fallbackReplyService,
  slaWatcher,
  startSlaWatcher = false,
  rateLimit = createRateLimit(),
  requestTimeout = createRequestTimeout(),
  corsOrigins = parseCorsOrigins(),
  pipelineObserver = () => {},
  shopConfigs
} = {}) {
  const chatService = new ChatService({
    vectorStore,
    provider,
    auditLogger,
    reviewQueue,
    policyClassifier,
    contentSafety,
    metricsService,
    shopConfigs
  });
  const adapters = platformAdapters ?? {
    manual: new ManualAdapter({ webhookSecurity }),
    douyin: new DouyinAdapter(),
    taobao: new TaobaoAdapter(),
    amazon: new PlatformAdapter({ platform: "amazon", configured: false })
  };
  const fallbackService = fallbackReplyService ?? new FallbackReplyService({
    adapters
  });
  const watcher = slaWatcher ?? new SlaWatcher({
    slaTracker,
    escalationService,
    fallbackReplyService: fallbackService
  });
  if (startSlaWatcher) watcher.start();
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  const api = express.Router();
  api.use(createAuthMiddleware(authService));
  api.use(createCorsMiddleware(corsOrigins));
  api.use(express.json({
    limit: "32kb",
    verify: (request, _response, buffer) => {
      request.rawBody = buffer.toString("utf8");
    }
  }));
  api.use(createTenantResolver());
  api.use(rateLimit);
  api.use(requestTimeout);
  api.use(createContentSafetyGate(contentSafety));

  api.post("/kb/documents", (request, response, next) => {
    try {
      const document = vectorStore.addDocument(request.tenantContext, {
        ...request.body,
        shopId: request.shopId
      });
      response.status(201).json(document);
    } catch (error) {
      next(error);
    }
  });

  api.get("/kb/documents", (request, response) => {
    return response.json({
      items: vectorStore.listDocuments(request.tenantContext)
    });
  });

  api.delete("/kb/documents/:id", (request, response) => {
    if (!vectorStore.deleteDocument(
      request.tenantContext,
      request.params.id
    )) {
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
      const idempotencyKey = requestId ? String(requestId) : null;
      if (idempotencyKey && !idempotencyStore.reserve(
        `chat_preview:${request.shopId}:${idempotencyKey}`
      )) {
        return response.json({
          requestId: idempotencyKey,
          duplicate: true,
          status: "NEEDS_HUMAN",
          reply: HUMAN_HANDOFF_REPLY,
          confidence: 0,
          knowledgeHit: false
        });
      }
      const result = await Promise.race([
        chatService.preview({
          tenantContext: request.tenantContext,
          buyerMessage,
          requestId,
          signal: request.abortSignal,
          pipelineTrace: request.pipelineTrace
        }),
        request.timeoutPromise
      ]);
      if (result === REQUEST_TIMEOUT) {
        pipelineObserver([...request.pipelineTrace]);
        metricsService.recordError();
        const timeoutResponse = {
          requestId: requestId ?? "",
          status: "NEEDS_HUMAN",
          reply: HUMAN_HANDOFF_REPLY,
          confidence: 0,
          knowledgeHit: false
        };
        return response.status(503).json(timeoutResponse);
      }
      metricsService.recordChatResult(result);
      if (idempotencyKey) {
        idempotencyStore.complete(`chat_preview:${request.shopId}:${idempotencyKey}`);
      }
      pipelineObserver([...request.pipelineTrace]);
      return response.json(result);
    } catch (error) {
      return next(error);
    }
  });

  api.get("/reviews", (request, response, next) => {
    try {
      return response.json({
        items: reviewQueue.list({
          shopId: request.shopId,
          status: request.query.status
        })
      });
    } catch (error) {
      return next(error);
    }
  });

  api.post("/reviews/:id/approve", async (request, response, next) => {
    try {
      const review = reviewQueue.approve(request.shopId, request.params.id);
      if (!review) return response.status(404).json({ error: "Review not found" });
      return response.json({ review });
    } catch (error) {
      return next(error);
    }
  });

  api.post("/reviews/:id/send", async (request, response, next) => {
    try {
      const review = reviewQueue.get(request.shopId, request.params.id);
      if (!review) return response.status(404).json({ error: "Review not found" });
      if (review.status !== "APPROVED") {
        return response.status(409).json({
          error: "Review must be approved before send",
          code: "REVIEW_NOT_APPROVED"
        });
      }
      const platform = String(request.body?.platform ?? "manual").toLowerCase();
      const adapter = adapters[platform];
      if (!adapter || !adapter.getCapabilities().configured) {
        return platformNotConfigured(response);
      }
      const command = createReplyCommand({
        shopId: request.shopId,
        platform,
        conversationId: request.body?.conversationId,
        platformMessageId: request.body?.platformMessageId,
        replyText: review.ai_reply,
        approvedBy: request.body?.approvedBy,
        idempotencyKey:
          request.body?.idempotencyKey ??
          `${platform}:${request.shopId}:${request.body?.platformMessageId}:reply`
      });
      const receipt = await adapter.sendReply(command);
      if (receipt?.code === "PLATFORM_NOT_CONFIGURED") {
        return platformNotConfigured(response);
      }
      if (receipt?.ok !== false) {
        const sla = slaTracker.findByMessage({
          shopId: request.shopId,
          platform,
          platformMessageId: command.platformMessageId
        });
        if (sla) {
          slaTracker.markFirstReply(sla.id, SLA_STATUSES.HUMAN_REPLIED);
        }
      }
      return response.json({ command, receipt });
    } catch (error) {
      return next(error);
    }
  });

  api.post("/reviews/:id/reject", (request, response, next) => {
    try {
      const review = reviewQueue.reject(request.shopId, request.params.id);
      if (!review) return response.status(404).json({ error: "Review not found" });
      return response.json({ review });
    } catch (error) {
      return next(error);
    }
  });

  api.post(
    "/webhooks/mock",
    createWebhookSignatureMiddleware(webhookSecurity),
    (request, response) => {
      const platformMessageId = request.body?.platformMessageId;
      if (!platformMessageId) {
        return response.status(400).json({
          error: "platformMessageId is required",
          code: "PLATFORM_MESSAGE_ID_REQUIRED"
        });
      }
      const legacyKey = `legacy_webhook:${request.shopId}:${platformMessageId}`;
      if (!idempotencyStore.reserve(legacyKey)) {
        return response.json({ duplicate: true, platformMessageId: String(platformMessageId) });
      }
      const result = {
        status: "ACCEPTED",
        platformMessageId: String(platformMessageId)
      };
      idempotencyStore.complete(legacyKey);
      return response.json(result);
    }
  );

  api.post("/webhooks/:platform/messages", async (request, response, next) => {
    try {
      const platform = String(request.params.platform).toLowerCase();
      const adapter = adapters[platform];
      if (!adapter) {
        return platformNotConfigured(response);
      }
      const verification = await adapter.verifyWebhook(request);
      if (!verification.ok) {
        if (verification.code === "PLATFORM_NOT_CONFIGURED") {
          return platformNotConfigured(response);
        }
        return webhookRejected(response, verification.code);
      }
      const normalized = adapter.normalizeIncomingMessage({
        ...request.body,
        platform,
        shopId: request.shopId,
        idempotencyKey: `${platform}:${request.shopId}:${request.body?.platformMessageId}`
      });
      const sla = slaTracker.createForMessage(normalized);
      const idempotencyKey = normalized.idempotencyKey;
      if (!idempotencyStore.reserve(idempotencyKey)) {
        return response.json({
          duplicate: true,
          idempotencyKey
        });
      }
      slaTracker.updateStatus(sla.id, SLA_STATUSES.AI_PROCESSING);
      const result = await chatService.preview({
        tenantContext: request.tenantContext,
        buyerMessage: normalized.messageText,
        requestId: idempotencyKey,
        signal: request.abortSignal,
        pipelineTrace: request.pipelineTrace
      });
      metricsService.recordChatResult(result);
      idempotencyStore.complete(idempotencyKey);
      if (result.status === "AUTO_REPLIED") {
        slaTracker.markFirstReply(sla.id, SLA_STATUSES.AUTO_REPLIED);
      } else {
        slaTracker.updateStatus(sla.id, SLA_STATUSES.PENDING_REVIEW);
      }
      return response.json({
        duplicate: false,
        platform,
        platformMessageId: normalized.platformMessageId,
        slaId: sla.id,
        preview: result
      });
    } catch (error) {
      return next(error);
    }
  });

  api.get("/integrations/:platform/authorize", (request, response) => {
    const platform = String(request.params.platform).toLowerCase();
    const adapter = adapters[platform];
    if (!adapter || !adapter.getCapabilities().configured) {
      return platformNotConfigured(response);
    }
    const state = oauthStateStore.create({ shopId: request.shopId, platform });
    const authorization = adapter.getAuthorizationUrl(state);
    if (authorization?.code === "PLATFORM_NOT_CONFIGURED") {
      return platformNotConfigured(response);
    }
    return response.json({
      platform,
      state,
      authorizationUrl: authorization.authorizationUrl
    });
  });

  api.get("/integrations/:platform/callback", async (request, response, next) => {
    try {
      const platform = String(request.params.platform).toLowerCase();
      const adapter = adapters[platform];
      if (!adapter || !adapter.getCapabilities().configured) {
        return platformNotConfigured(response);
      }
      const state = request.query.state;
      if (!state) {
        return response.status(400).json({
          error: "OAuth state is required",
          code: "OAUTH_STATE_REQUIRED"
        });
      }
      if (!oauthStateStore.consume({ shopId: request.shopId, platform, state })) {
        return response.status(400).json({
          error: "OAuth state is invalid or expired",
          code: "OAUTH_STATE_INVALID"
        });
      }
      const result = await adapter.exchangeAuthorizationCode(request.query.code);
      if (result?.code === "PLATFORM_NOT_CONFIGURED") {
        return platformNotConfigured(response);
      }
      return response.json({
        platform,
        status: "AUTHORIZED",
        encryptedToken: result.encryptedToken ?? null,
        keyRotation: {
          supported: true,
          keyVersion: result.keyVersion ?? null
        }
      });
    } catch (error) {
      return next(error);
    }
  });

  api.get("/metrics", (request, response) => {
    return response.json({
      shopId: request.shopId,
      metrics: metricsService.snapshot()
    });
  });

  app.use("/api/v1", api);

  app.use((error, _request, response, next) => {
    if (response.headersSent) return next(error);
    const isClientError = error instanceof TypeError || error instanceof SyntaxError;
    if (isClientError) {
      app.locals.services?.metricsService?.recordError();
      response.status(400).json({ error: error.message });
      return;
    }
    app.locals.services?.metricsService?.recordError();
    response.status(500).json({
      status: "NEEDS_HUMAN",
      reply: HUMAN_HANDOFF_REPLY,
      confidence: 0,
      knowledgeHit: false
    });
  });

  app.locals.services = {
    vectorStore,
    provider,
    auditLogger,
    reviewQueue,
    platformAdapter,
    platformAdapters: adapters,
    authService,
    policyClassifier,
    contentSafety,
    chatService,
    idempotencyStore,
    oauthStateStore,
    metricsService,
    webhookSecurity,
    slaTracker,
    slaWatcher: watcher,
    fallbackReplyService: fallbackService,
    escalationService,
    database,
    securityPipelineOrder: SECURITY_PIPELINE_ORDER
  };
  return app;
}

const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  const port = Number(process.env.PORT ?? 3000);
  createApp({ startSlaWatcher: true }).listen(port, () => {
    console.log(`AI Shop Copilot RC1 listening on port ${port}`);
  });
}

export {
  DEFAULT_CORS_ORIGINS,
  parseCorsOrigins,
  SECURITY_PIPELINE_ORDER
};

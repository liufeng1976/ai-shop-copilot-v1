import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(String(left)) || !/^[a-f0-9]{64}$/i.test(String(right))) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function signWebhookPayload({ secret, timestamp, body }) {
  return createHmac("sha256", String(secret))
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

export class WebhookSecurity {
  constructor({
    secret = process.env.WEBHOOK_SECRET ?? "local-webhook-secret",
    database,
    toleranceMs = DEFAULT_TOLERANCE_MS,
    nodeEnv = process.env.NODE_ENV
  } = {}) {
    if (!database?.db) throw new TypeError("SQLite database is required");
    if (nodeEnv === "production" && secret === "local-webhook-secret") {
      throw new Error("default webhook secret is forbidden in production");
    }
    this.secret = String(secret);
    this.database = database;
    this.toleranceMs = toleranceMs;
  }

  verify({ timestamp, signature, body, nonce = randomUUID() }) {
    const parsedTimestamp = Number(timestamp);
    if (!Number.isFinite(parsedTimestamp)) {
      return { ok: false, code: "WEBHOOK_BAD_TIMESTAMP" };
    }
    if (Math.abs(Date.now() - parsedTimestamp) > this.toleranceMs) {
      return { ok: false, code: "WEBHOOK_TIMESTAMP_EXPIRED" };
    }
    const expected = signWebhookPayload({
      secret: this.secret,
      timestamp: parsedTimestamp,
      body: String(body ?? "")
    });
    if (!safeEqualHex(signature, expected)) {
      return { ok: false, code: "WEBHOOK_BAD_SIGNATURE" };
    }
    const inserted = this.database.db
      .prepare("INSERT OR IGNORE INTO webhook_replay_nonces (nonce, created_at) VALUES (?, ?)")
      .run(String(nonce), Date.now());
    if (inserted.changes !== 1) {
      return { ok: false, code: "WEBHOOK_REPLAY_DETECTED" };
    }
    return { ok: true, code: "WEBHOOK_VERIFIED" };
  }
}

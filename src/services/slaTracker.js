import { randomUUID } from "node:crypto";
import { SqliteDatabase } from "./database.js";

const STATUSES = Object.freeze({
  RECEIVED: "RECEIVED",
  AI_PROCESSING: "AI_PROCESSING",
  PENDING_REVIEW: "PENDING_REVIEW",
  AUTO_REPLIED: "AUTO_REPLIED",
  FALLBACK_REPLIED: "FALLBACK_REPLIED",
  HUMAN_REPLIED: "HUMAN_REPLIED",
  EXPIRED: "EXPIRED"
});

function plusSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000).toISOString();
}

function publicRecord(row) {
  return row
    ? structuredClone({
        id: row.id,
        shop_id: row.shop_id,
        platform: row.platform,
        platform_message_id: row.platform_message_id,
        conversation_id: row.conversation_id,
        received_at: row.received_at,
        deadline_at: row.deadline_at,
        warn_at: row.warn_at,
        fallback_at: row.fallback_at,
        first_reply_sent_at: row.first_reply_sent_at,
        status: row.status
      })
    : null;
}

export class SlaTracker {
  constructor({ database = new SqliteDatabase() } = {}) {
    this.database = database;
  }

  createForMessage(message, { now = new Date(message.receivedAt ?? Date.now()) } = {}) {
    const receivedAt = new Date(now);
    const record = {
      id: randomUUID(),
      shop_id: String(message.shopId),
      platform: String(message.platform),
      platform_message_id: String(message.platformMessageId),
      conversation_id: String(message.conversationId),
      received_at: receivedAt.toISOString(),
      deadline_at: plusSeconds(receivedAt, 180),
      warn_at: plusSeconds(receivedAt, 90),
      fallback_at: plusSeconds(receivedAt, 150),
      first_reply_sent_at: null,
      status: STATUSES.RECEIVED
    };
    this.database.db
      .prepare(
        `INSERT OR IGNORE INTO sla_records
          (id, shop_id, platform, platform_message_id, conversation_id,
           received_at, deadline_at, warn_at, fallback_at, first_reply_sent_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.shop_id,
        record.platform,
        record.platform_message_id,
        record.conversation_id,
        record.received_at,
        record.deadline_at,
        record.warn_at,
        record.fallback_at,
        record.first_reply_sent_at,
        record.status
      );
    return this.findByMessage({
      shopId: record.shop_id,
      platform: record.platform,
      platformMessageId: record.platform_message_id
    });
  }

  findByMessage({ shopId, platform, platformMessageId }) {
    return publicRecord(
      this.database.db
        .prepare(
          `SELECT * FROM sla_records
           WHERE shop_id = ? AND platform = ? AND platform_message_id = ?`
        )
        .get(String(shopId), String(platform), String(platformMessageId))
    );
  }

  get(id) {
    return publicRecord(
      this.database.db
        .prepare("SELECT * FROM sla_records WHERE id = ?")
        .get(String(id))
    );
  }

  updateStatus(id, status) {
    this.database.db
      .prepare("UPDATE sla_records SET status = ? WHERE id = ?")
      .run(String(status), String(id));
    return this.get(id);
  }

  markFirstReply(id, status, { now = new Date() } = {}) {
    this.database.db
      .prepare(
        `UPDATE sla_records
         SET status = ?,
             first_reply_sent_at = COALESCE(first_reply_sent_at, ?)
         WHERE id = ?`
      )
      .run(String(status), new Date(now).toISOString(), String(id));
    return this.get(id);
  }

  listPending({ now = new Date() } = {}) {
    return this.database.db
      .prepare(
        `SELECT * FROM sla_records
         WHERE first_reply_sent_at IS NULL
           AND status IN ('RECEIVED', 'AI_PROCESSING', 'PENDING_REVIEW')
           AND (warn_at <= ? OR fallback_at <= ? OR deadline_at <= ?)
         ORDER BY received_at ASC`
      )
      .all(
        new Date(now).toISOString(),
        new Date(now).toISOString(),
        new Date(now).toISOString()
      )
      .map(publicRecord);
  }

  list({ shopId } = {}) {
    const rows = shopId
      ? this.database.db
          .prepare("SELECT * FROM sla_records WHERE shop_id = ? ORDER BY received_at ASC")
          .all(String(shopId))
      : this.database.db
          .prepare("SELECT * FROM sla_records ORDER BY received_at ASC")
          .all();
    return rows.map(publicRecord);
  }
}

export { STATUSES as SLA_STATUSES };

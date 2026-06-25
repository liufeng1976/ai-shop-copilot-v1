import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

function ensureParentDirectory(filename) {
  if (!filename || filename === ":memory:") return;
  mkdirSync(dirname(filename), { recursive: true });
}

export class SqliteDatabase {
  constructor({ filename = process.env.SQLITE_PATH ?? ":memory:" } = {}) {
    ensureParentDirectory(filename);
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.#migrate();
  }

  #migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kb_documents (
        id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL,
        title TEXT NOT NULL,
        source_type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kb_documents_shop
        ON kb_documents(shop_id);

      CREATE TABLE IF NOT EXISTS review_queue (
        id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        ai_reply TEXT NOT NULL,
        confidence REAL NOT NULL,
        intent TEXT NOT NULL DEFAULT 'UNKNOWN',
        risk_level TEXT NOT NULL DEFAULT 'LOW',
        priority TEXT NOT NULL DEFAULT 'LOW',
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_review_queue_shop_status
        ON review_queue(shop_id, status);
      CREATE INDEX IF NOT EXISTS idx_review_queue_priority
        ON review_queue(shop_id, status, priority, created_at);

      CREATE TABLE IF NOT EXISTS idempotency_keys (
        shop_id TEXT NOT NULL,
        key TEXT NOT NULL,
        kind TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (shop_id, key, kind)
      );

      CREATE TABLE IF NOT EXISTS webhook_replay_nonces (
        nonce TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sla_records (
        id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        platform_message_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        received_at TEXT NOT NULL,
        deadline_at TEXT NOT NULL,
        warn_at TEXT NOT NULL,
        fallback_at TEXT NOT NULL,
        first_reply_sent_at TEXT,
        status TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sla_records_message
        ON sla_records(shop_id, platform, platform_message_id);
      CREATE INDEX IF NOT EXISTS idx_sla_records_status
        ON sla_records(status, fallback_at, deadline_at);
    `);
    this.#ensureColumn("review_queue", "intent", "TEXT NOT NULL DEFAULT 'UNKNOWN'");
    this.#ensureColumn("review_queue", "risk_level", "TEXT NOT NULL DEFAULT 'LOW'");
    this.#ensureColumn("review_queue", "priority", "TEXT NOT NULL DEFAULT 'LOW'");
  }

  #ensureColumn(table, column, definition) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
    if (columns.some((item) => item.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  close() {
    this.db.close();
  }
}

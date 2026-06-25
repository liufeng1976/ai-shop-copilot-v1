import { SLA_STATUSES } from "./slaTracker.js";

export class SlaWatcher {
  constructor({
    slaTracker,
    escalationService,
    fallbackReplyService,
    intervalMs = 10_000,
    now = () => new Date()
  } = {}) {
    this.slaTracker = slaTracker;
    this.escalationService = escalationService;
    this.fallbackReplyService = fallbackReplyService;
    this.intervalMs = intervalMs;
    this.now = now;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.scan().catch(() => {});
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async scan({ now = this.now() } = {}) {
    const current = new Date(now);
    const records = this.slaTracker.listPending({ now: current });
    const actions = [];
    for (const record of records) {
      if (
        current >= new Date(record.warn_at) &&
        !this.escalationService.has({ slaId: record.id, severity: "WARN" })
      ) {
        const event = this.escalationService.create({
          shopId: record.shop_id,
          platform: record.platform,
          conversationId: record.conversation_id,
          slaId: record.id,
          severity: "WARN"
        });
        if (event) actions.push({ type: "ESCALATED", event });
      }

      const latestBeforeFallback = this.slaTracker.get(record.id);
      if (
        latestBeforeFallback?.first_reply_sent_at === null &&
        current >= new Date(latestBeforeFallback.fallback_at)
      ) {
        const fallback = await this.fallbackReplyService.sendFallback(latestBeforeFallback);
        if (fallback.ok) {
          const updated = this.slaTracker.markFirstReply(
            latestBeforeFallback.id,
            SLA_STATUSES.FALLBACK_REPLIED,
            { now: current }
          );
          actions.push({ type: "FALLBACK_REPLIED", record: updated });
          continue;
        }
      }

      const latest = this.slaTracker.get(record.id);
      if (
        latest?.first_reply_sent_at === null &&
        current >= new Date(latest.deadline_at)
      ) {
        const expired = this.slaTracker.updateStatus(latest.id, SLA_STATUSES.EXPIRED);
        actions.push({ type: "EXPIRED", record: expired });
      }
    }
    return actions;
  }
}

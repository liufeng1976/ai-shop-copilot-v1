export class EscalationService {
  #events = [];

  create({ shopId, platform, conversationId, slaId, severity }) {
    if (this.has({ slaId, severity })) return null;
    const event = Object.freeze({
      shop_id: String(shopId),
      platform: String(platform),
      conversation_id: String(conversationId),
      sla_id: String(slaId),
      severity: String(severity),
      created_at: new Date().toISOString()
    });
    this.#events.push(event);
    return structuredClone(event);
  }

  has({ slaId, severity }) {
    return this.#events.some(
      (event) => event.sla_id === String(slaId) && event.severity === String(severity)
    );
  }

  list() {
    return structuredClone(this.#events);
  }
}

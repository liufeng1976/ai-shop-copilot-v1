export class AuditLogger {
  #records = [];

  record({ requestId, shopId, action, status, latencyMs, tokenUsage }) {
    const record = Object.freeze({
      request_id: String(requestId),
      shop_id: String(shopId),
      action: String(action),
      status: String(status),
      latency_ms: Number(latencyMs),
      token_usage: {
        prompt_tokens: Number(tokenUsage?.prompt_tokens ?? 0),
        completion_tokens: Number(tokenUsage?.completion_tokens ?? 0),
        total_tokens: Number(tokenUsage?.total_tokens ?? 0)
      }
    });
    this.#records.push(record);
    return structuredClone(record);
  }

  list() {
    return structuredClone(this.#records);
  }
}

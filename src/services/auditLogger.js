function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export class AuditLogger {
  #records = [];

  record(input = {}) {
    const record = Object.freeze({
      request_id: String(input.requestId ?? ""),
      shop_id: String(input.shopId ?? ""),
      action: String(input.action ?? ""),
      status: String(input.status ?? ""),
      latency_ms: safeNumber(input.latencyMs),
      token_usage: {
        prompt_tokens: safeNumber(input.tokenUsage?.prompt_tokens),
        completion_tokens: safeNumber(input.tokenUsage?.completion_tokens),
        total_tokens: safeNumber(input.tokenUsage?.total_tokens)
      }
    });
    this.#records.push(record);
    return structuredClone(record);
  }

  list() {
    return structuredClone(this.#records);
  }
}

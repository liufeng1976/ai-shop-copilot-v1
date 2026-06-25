const DEFAULT_COUNTERS = Object.freeze({
  request_total: 0,
  error_total: 0,
  llm_failure_total: 0,
  human_handoff_total: 0
});

export class MetricsService {
  #counters = { ...DEFAULT_COUNTERS };

  increment(name, value = 1) {
    if (!Object.hasOwn(this.#counters, name)) return;
    this.#counters[name] += Number.isFinite(Number(value)) ? Number(value) : 1;
  }

  recordChatResult(result = {}) {
    this.increment("request_total");
    if (result.status === "NEEDS_HUMAN" || result.status === "PENDING_REVIEW") {
      this.increment("human_handoff_total");
    }
  }

  recordError() {
    this.increment("error_total");
  }

  recordLlmFailure() {
    this.increment("llm_failure_total");
  }

  snapshot() {
    const total = this.#counters.request_total || 0;
    return {
      ...this.#counters,
      error_rate: total ? this.#counters.error_total / total : 0,
      llm_failure_rate: total ? this.#counters.llm_failure_total / total : 0,
      human_handoff_rate: total ? this.#counters.human_handoff_total / total : 0
    };
  }
}

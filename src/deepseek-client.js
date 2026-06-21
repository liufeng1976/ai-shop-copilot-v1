const SYSTEM_PROMPT = `You are an ecommerce customer-service copilot.
Draft a concise, helpful reply for a human agent to review.
Use only the supplied store knowledge. If the knowledge is insufficient, say that a human should verify.
Never repeat or infer personal data, contact details, order numbers, addresses, or customer profiles.
Do not claim that an action has already been completed.`;

export class DeepSeekClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async draftReply({ buyerMessage, knowledge }) {
    if (this.config.mode === "mock") {
      return this.#mockReply(knowledge);
    }

    if (!this.config.apiKey) {
      throw new Error("DEEPSEEK_API_KEY is required in live mode");
    }

    const response = await this.fetch(
      `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: this.config.model,
          stream: false,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: JSON.stringify({
                storeKnowledge: knowledge.map(({ title, content }) => ({ title, content })),
                buyerRequest: buyerMessage
              })
            }
          ]
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs)
      }
    );

    if (!response.ok) {
      throw new Error(`DeepSeek request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const reply = payload.choices?.[0]?.message?.content;
    if (!reply) {
      throw new Error("DeepSeek returned an empty reply");
    }
    return reply;
  }

  #mockReply(knowledge) {
    const bestMatch = knowledge[0];
    if (!bestMatch || bestMatch.score <= 0) {
      return "暂未找到足够的店铺资料，请人工客服核实后回复。";
    }
    return `根据店铺资料：${bestMatch.content} 请人工客服确认后发送。`;
  }
}

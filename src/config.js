import "dotenv/config";

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT ?? 3000),
    reviewApiKey: env.REVIEW_API_KEY ?? "",
    deepSeek: {
      apiKey: env.DEEPSEEK_API_KEY ?? "",
      baseUrl: env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      model: env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
      mode: env.DEEPSEEK_MODE ?? (env.DEEPSEEK_API_KEY ? "live" : "mock"),
      timeoutMs: Number(env.DEEPSEEK_TIMEOUT_MS ?? 15000)
    }
  };
}

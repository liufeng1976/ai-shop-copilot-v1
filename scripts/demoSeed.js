#!/usr/bin/env node
import { DEMO_SCENARIOS, publicScenario } from "../src/demo/demoScenarios.js";

const baseUrl = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const apiKey = process.env.DEMO_API_KEY ?? "demo-secret-key";
const runId = process.env.DEMO_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, "-");

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      ...(options.headers ?? {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed: ${response.status} ${body.code ?? body.error ?? ""}`);
  }
  return body;
}

async function main() {
  const seeded = [];
  for (const scenario of DEMO_SCENARIOS) {
    const requestId = `${scenario.requestId}-${runId}`;
    const result = await requestJson("/api/v1/chat/preview", {
      method: "POST",
      body: JSON.stringify({
        requestId,
        buyerMessage: scenario.buyerMessage
      })
    });
    seeded.push({
      ...publicScenario({ ...scenario, requestId }),
      status: result.status,
      actualIntent: result.intent,
      riskLevel: result.riskLevel,
      allowAutoSend: result.allowAutoSend
    });
  }

  const summary = await requestJson("/api/v1/reviews/summary");
  const highPriority = await requestJson("/api/v1/reviews?priority=HIGH&status=PENDING");

  console.log("Demo seed completed. Buyer messages were used only as request input and are not printed.");
  console.table(seeded);
  console.log("Review summary:");
  console.log(JSON.stringify(summary.summary, null, 2));
  console.log("High priority pending reviews:");
  console.table(highPriority.items.map((item) => ({
    id: item.id,
    request_id: item.request_id,
    intent: item.intent,
    priority: item.priority,
    status: item.status,
    review_note: item.review_note
  })));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

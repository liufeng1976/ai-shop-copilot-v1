import assert from "node:assert/strict";
import { test } from "node:test";
import { DeepSeekClient } from "../src/deepseek-client.js";

test("DeepSeek client uses the OpenAI-compatible chat completions endpoint", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: "建议回复" } }] };
      }
    };
  };
  const client = new DeepSeekClient(
    {
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      mode: "live",
      timeoutMs: 1000
    },
    fetchImpl
  );

  const reply = await client.draftReply({
    buyerMessage: "何时发货？",
    knowledge: [{ title: "发货", content: "48 小时内发货。" }]
  });

  const body = JSON.parse(captured.options.body);
  assert.equal(captured.url, "https://api.deepseek.com/chat/completions");
  assert.equal(captured.options.headers.authorization, "Bearer test-key");
  assert.equal(body.model, "deepseek-v4-flash");
  assert.equal(body.stream, false);
  assert.equal(reply, "建议回复");
});

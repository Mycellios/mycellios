// Real check that a model's read prompt survives an unload: a long agent-like prompt is read
// once, the model is unloaded (its slot saved) and loaded again (kernels warmed, slot restored);
// the next turn with the same prefix must reuse it instead of reading it again.
// Usage: npx tsx apps/desktop/scripts/verify-local-model-reload.ts <dir> [modelId]
import { LocalModels } from "../src/local-models.ts";

const [directory, modelId = "qwen3.5-2b"] = process.argv.slice(2);
if (!directory) throw new Error("Usage: verify-local-model-reload.ts <dir> [modelId]");
const models = new LocalModels(directory);
const system = "You are Mico, a helpful assistant on the person's PC. Keep answers short. ".repeat(260);
async function turn(question: string) {
  const endpoint = await models.endpoint(modelId);
  const started = performance.now();
  const response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${endpoint.apiKey}` },
    body: JSON.stringify({ messages: [{ role: "system", content: system }, { role: "user", content: question }], max_tokens: 24, temperature: 0 }),
  });
  const body = await response.json() as { timings?: { prompt_n?: number; cache_n?: number } };
  return { seconds: Math.round((performance.now() - started) / 100) / 10, read: body.timings?.prompt_n, reused: body.timings?.cache_n };
}
try {
  let started = performance.now();
  await models.warm(modelId);
  console.log(`load + warm ${Math.round(performance.now() - started)} ms`);
  console.log("first turn (reads the whole prompt):", await turn("Say hello."));
  console.log("same session:", await turn("Say goodbye."));
  await models.unload();
  started = performance.now();
  await models.warm(modelId);
  console.log(`reload + restore ${Math.round(performance.now() - started)} ms`);
  const after = await turn("Say thanks.");
  console.log("after reload:", after);
  if (!after.reused || after.reused < 1000) process.exitCode = 1;
} finally {
  await models.unload();
}

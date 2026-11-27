// Real qualification of the local model runtime on this PC: engine download, model
// verification, load, measured speed and loopback key enforcement.
// Usage: npx tsx apps/desktop/scripts/verify-local-models.ts <empty-or-prepared dir> [modelId]
// Pre-copying the pinned GGUF into <dir>/models/<id>-<sha12>.gguf skips its download;
// it is still verified by size and SHA-256 before use.
import { LocalModels } from "../src/local-models.ts";

const [directory, modelId = "qwen3.5-2b"] = process.argv.slice(2);
if (!directory) throw new Error("Usage: verify-local-models.ts <dir> [modelId]");
const models = new LocalModels(directory);
const progress = setInterval(async () => {
  const job = (await models.status()).job;
  if (job) console.log(`  ${job.phase} ${job.downloaded}/${job.total}`);
}, 3_000);
try {
  let started = Date.now();
  await models.inspect();
  let status = await models.status();
  console.log(`inspect ${Date.now() - started} ms`, JSON.stringify({ inspected: status.inspected, hardware: status.hardware, recommended: status.recommended, smarter: status.smarter }));
  started = Date.now();
  await models.install(modelId);
  status = await models.status();
  const model = status.models.find((candidate) => candidate.id === modelId);
  console.log(`install ${Date.now() - started} ms`, JSON.stringify({ loaded: status.loaded, fit: model?.fit, speed: model?.speed, recommended: status.recommended, smarter: status.smarter }));
  const endpoint = await models.endpoint(modelId);
  const anonymous = await fetch(`${endpoint.baseUrl}/models`);
  const keyed = await fetch(`${endpoint.baseUrl}/models`, { headers: { authorization: `Bearer ${endpoint.apiKey}` } });
  console.log(`without key ${anonymous.status}, with key ${keyed.status}, url ${endpoint.baseUrl.replace(/:\d+/, ":<port>")}`);
  if (anonymous.status !== 401 || keyed.status !== 200) process.exitCode = 1;
} finally {
  clearInterval(progress);
  await models.unload();
}

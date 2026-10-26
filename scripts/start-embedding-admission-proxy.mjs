import fs from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

// This entrypoint runs only inside the pinned native runtime image. No secrets
// or database configuration are required; the upstream owns authentication.
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const [file, expected] of Object.entries(config.files)) {
  const observed = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (observed !== expected) throw new Error("admission_runtime_file_mismatch");
}
const { createEmbeddingAdmissionProxy } = await import(pathToFileURL(config.module));
const contract = await import(pathToFileURL(config.contract));
const runtime = createEmbeddingAdmissionProxy({ upstream: config.upstream, contract, sourceId: config.sourceId });
await runtime.listen("0.0.0.0", 8080);
console.log(JSON.stringify({ status: "ready", sourceId: config.sourceId }));
process.once("SIGTERM", () => { void runtime.close().then(() => process.exit(0)); });
process.once("SIGINT", () => { void runtime.close().then(() => process.exit(0)); });

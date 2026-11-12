/** Explicit local asset preparation; downloads pinned public MIT weights, never calls inference providers. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { browserTextModel } from "../src/contracts/browser-text.js";
const directory = resolve(process.argv[2] ?? ".cache/browser-text-models", browserTextModel.files["model.onnx"].sha256);
await mkdir(directory, { recursive: true });
for (const [name, file] of Object.entries(browserTextModel.files)) {
  const target = resolve(directory, name);
  let bytes: Buffer | undefined;
  try { bytes = await readFile(target); } catch {}
  const valid = (value: Uint8Array) => value.byteLength === file.bytes && createHash("sha256").update(value).digest("hex") === file.sha256;
  if (bytes && valid(bytes)) { console.log(`${name}: cached, SHA-256 verified`); continue; }
  const response = await fetch(`https://huggingface.co/${browserTextModel.repository}/resolve/${browserTextModel.revision}/${file.source}`, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error(`model asset download HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (!valid(bytes)) throw new Error(`pinned model asset mismatch: ${name}`);
  await writeFile(target + ".partial", bytes); await rename(target + ".partial", target);
  console.log(`${name}: ${bytes.length} bytes, pinned SHA-256 verified`);
}
console.log(`BROWSER_TEXT_MODELS_PATH=${resolve(directory, "..")}`);

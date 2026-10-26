import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";

const { values } = parseArgs({ options: Object.fromEntries(
  ["output", "base-image", "nginx-image", "contract-sha256", "upstream", "main", "compiler-api"].map(name => [name, { type: "string" }]),
) });
for (const name of ["output", "base-image", "nginx-image", "contract-sha256", "upstream", "main", "compiler-api"]) {
  if (!values[name]) throw new Error(`Missing --${name}`);
}
for (const name of ["base-image", "nginx-image"]) {
  if (!/^sha256:[a-f0-9]{64}$/.test(values[name])) throw new Error(`--${name} must be an immutable image ID`);
}
if (!/^[a-f0-9]{64}$/.test(values["contract-sha256"]) || !/^[a-f0-9]{40}$/.test(values.main)) throw new Error("Invalid contract hash or main revision");
const ts = createRequire(import.meta.url)(path.resolve(values["compiler-api"]));
if (ts.version !== "6.0.3" || typeof ts.transpileModule !== "function") throw new Error("The pinned TypeScript 6.0.3 compiler API is required");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(values.output);
if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error("Use a new or empty output directory");
fs.mkdirSync(output, { recursive: true });
const sourcePath = "src/coordinator/embedding-admission-proxy.ts";
const cliPath = "scripts/start-embedding-admission-proxy.mjs";
const source = fs.readFileSync(path.join(root, sourcePath), "utf8");
const cli = fs.readFileSync(path.join(root, cliPath));
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true,
} }).outputText;
const sha = value => createHash("sha256").update(value).digest("hex");
const files = {
  "/app/dist/coordinator/embedding-admission-proxy.js": sha(compiled),
  "/app/dist/contracts/embedding.js": values["contract-sha256"],
  "/release/start.mjs": sha(cli),
};
const sourceId = "sha256:" + sha(JSON.stringify({ source: sha(source), files }));
const config = { module: "/app/dist/coordinator/embedding-admission-proxy.js",
  contract: "/app/dist/contracts/embedding.js", upstream: values.upstream, sourceId, files };
const configBytes = JSON.stringify(config, null, 2);
const candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const committed = (file, expected) => {
  try { return sha(execFileSync("git", ["show", `${candidateCommit}:${file}`], { cwd: root, stdio: ["ignore", "pipe", "ignore"] })) === expected; }
  catch { return false; }
};
const manifest = { baseImage: values["base-image"], nginxImage: values["nginx-image"], sourceId,
  sourceSha256: sha(source), files, compilerVersion: ts.version, configSha256: sha(configBytes), mainSynchronized: values.main,
  candidateCommit, sourceCommitted: committed(sourcePath, sha(source)) && committed(cliPath, sha(cli)), productionChanged: false };
for (const [name, content] of Object.entries({ "embedding-admission-proxy.js": compiled, "start.mjs": cli,
  "config.json": configBytes, "manifest.json": JSON.stringify(manifest, null, 2) })) fs.writeFileSync(path.join(output, name), content);
console.log(JSON.stringify(manifest));

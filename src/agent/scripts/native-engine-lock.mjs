#!/usr/bin/env node
// Writes packages/adapters/src/native-engines.lock.json from the vendors' own npm metadata
// (specs/native-engines/spec.md phase 3). Never edit its hashes or sizes by hand.
//
//   node scripts/native-engine-lock.mjs [codex=<version>] [claude=<version>] [opencode=<version>]
//
// Without an argument an engine keeps the version the current lock pins. Each engine records the npm
// dist-tag Desktop follows for updates (its channel). Each target records the exact tarball URL,
// npm's dist.integrity, the exact download size (read with a one-byte range request), npm's unpacked
// size and file count as extraction bounds, the executable inside it, and the suffix its package
// version adds to the engine version (Codex publishes `<version>-<target>`).
import { readFile, writeFile } from "node:fs/promises";

const LOCK = new URL("../packages/adapters/src/native-engines.lock.json", import.meta.url);
const REGISTRY = "https://registry.npmjs.org";
const TARGETS = ["win32-x64", "win32-arm64", "darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"];
/** The dist-tag of each engine's main package that Desktop checks for a newer version. */
const CHANNELS = {
  codex: { package: "@openai/codex", tag: "latest" },
  claude: { package: "@anthropic-ai/claude-code", tag: "stable" },
  opencode: { package: "opencode-ai", tag: "latest" },
};
const CODEX_TRIPLES = {
  "win32-x64": "x86_64-pc-windows-msvc", "win32-arm64": "aarch64-pc-windows-msvc",
  "darwin-arm64": "aarch64-apple-darwin", "darwin-x64": "x86_64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-musl", "linux-arm64": "aarch64-unknown-linux-musl",
};
// OpenCode's baseline x64 builds run on every x64 CPU; its Linux builds are the glibc ones.
const OPENCODE_PACKAGES = {
  "win32-x64": "opencode-windows-x64-baseline", "win32-arm64": "opencode-windows-arm64",
  "darwin-arm64": "opencode-darwin-arm64", "darwin-x64": "opencode-darwin-x64-baseline",
  "linux-x64": "opencode-linux-x64-baseline", "linux-arm64": "opencode-linux-arm64",
};
const exe = (target, name) => target.startsWith("win32") ? `${name}.exe` : name;
/** Where each engine's package for a target lives on npm, and its executable inside `package/`. */
const ENGINES = {
  codex: target => ({
    package: "@openai/codex", suffix: `-${target}`,
    executable: `vendor/${CODEX_TRIPLES[target]}/bin/${exe(target, "codex")}`,
  }),
  claude: target => ({ package: `@anthropic-ai/claude-code-${target}`, executable: exe(target, "claude") }),
  opencode: target => ({ package: OPENCODE_PACKAGES[target], executable: `bin/${exe(target, "opencode")}` }),
};
/** npm's own tarball address for a package version; the store accepts no other. */
const tarballUrl = (name, version) => `${REGISTRY}/${name}/-/${name.split("/").pop()}-${version}.tgz`;

async function metadata(name) {
  const response = await fetch(`${REGISTRY}/${name.replace("/", "%2F")}`, {
    headers: { accept: "application/vnd.npm.install-v1+json" }, redirect: "error",
  });
  if (!response.ok) throw new Error(`${name}: registry answered ${response.status}`);
  return response.json();
}

async function downloadBytes(url) {
  const response = await fetch(url, { headers: { range: "bytes=0-0" }, redirect: "error" });
  await response.body?.cancel();
  const total = Number(/\/(\d+)$/.exec(response.headers.get("content-range") ?? "")?.[1]);
  if (response.status !== 206 || !Number.isSafeInteger(total) || total <= 0)
    throw new Error(`${url}: no download size`);
  return total;
}

const current = JSON.parse(await readFile(LOCK, "utf8").catch(() => "{}"));
const requested = Object.fromEntries(process.argv.slice(2).map(arg => arg.split("=")));
const lock = { schemaVersion: 1, engines: {} };
for (const [engine, locate] of Object.entries(ENGINES)) {
  const version = requested[engine] ?? current.engines?.[engine]?.version;
  if (!version) throw new Error(`Pass ${engine}=<version>`);
  const targets = {};
  for (const target of TARGETS) {
    const where = locate(target);
    const packageVersion = `${version}${where.suffix ?? ""}`;
    const entry = (await metadata(where.package)).versions?.[packageVersion];
    if (!entry) throw new Error(`${where.package}@${packageVersion} is not published`);
    const { tarball, integrity, unpackedSize, fileCount } = entry.dist;
    if (!/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)) throw new Error(`${where.package}: no sha512 integrity`);
    if (tarball !== tarballUrl(where.package, packageVersion)) throw new Error(`${where.package}: unexpected tarball ${tarball}`);
    targets[target] = {
      package: where.package,
      url: tarball,
      integrity,
      bytes: await downloadBytes(tarball),
      unpackedBytes: unpackedSize,
      files: fileCount,
      executable: `package/${where.executable}`,
      ...(where.suffix ? { versionSuffix: where.suffix } : {}),
    };
  }
  lock.engines[engine] = { version, source: "npm", channel: CHANNELS[engine], targets };
}
await writeFile(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
console.log("Wrote", LOCK.pathname);

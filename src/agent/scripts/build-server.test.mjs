import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("server bundles load runtime exports instead of typecheck aliases and retain automatic JSX", async () => {
  const agent = fileURLToPath(new URL("../", import.meta.url));
  const outputs = path.join(agent, "outputs");
  await mkdir(outputs, { recursive: true });
  const fixture = await mkdtemp(path.join(outputs, "server-build-"));
  try {
    await mkdir(path.join(fixture, "src"));
    await writeFile(path.join(fixture, "package.json"), '{"type":"module"}');
    await writeFile(path.join(fixture, "src/widget.tsx"), 'export const Widget = () => <span>fixture</span>;');
    await writeFile(path.join(fixture, "src/index.ts"), 'import { z } from "zod"; import { Widget } from "./widget.js"; console.log(JSON.stringify({ok:z.string().safeParse("fixture").success,element:Widget().type}));');
    execFileSync(process.execPath, [path.join(agent, "scripts/build-server.mjs"), "src/index.ts"], { cwd: fixture, timeout: 60_000 });
    const output = await readFile(path.join(fixture, "dist/index.js"), "utf8");
    assert.doesNotMatch(output, /node_modules\/[^"\n]+\.d\.(?:c|m)?ts/);
    const result = execFileSync(process.execPath, ["dist/index.js"], { cwd: fixture, encoding: "utf8", timeout: 15_000 });
    assert.deepEqual(JSON.parse(result), { ok: true, element: "span" });
  } finally {
    const relative = path.relative(outputs, path.resolve(fixture));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Fixture escaped its output directory");
    await rm(fixture, { recursive: true, force: true });
  }
});

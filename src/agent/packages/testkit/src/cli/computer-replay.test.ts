import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const cli = fileURLToPath(new URL("./computer-replay.ts", import.meta.url));
it.each([
  ["--isolated", "--live"],
  ["--isolated", "--record=forbidden-recording.json"],
  ["--isolated", "--live", "--record=forbidden-recording.json"],
])("refuses paid capture flags before credentials or Docker: %j", (...args) => {
  // No provider keys are inherited; the guard must reject before any live setup.
  const env = Object.fromEntries(["PATH", "HOME", "SYSTEMROOT", "TEMP", "TMP"].flatMap(name => process.env[name] ? [[name, process.env[name]!]] : []));
  const result = spawnSync(process.execPath, ["--import", "tsx", cli, ...args], {
    cwd: path.resolve(path.dirname(cli), "../../../.."), env, encoding: "utf8", timeout: 15_000,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("--isolated is offline only");
}, 20_000);

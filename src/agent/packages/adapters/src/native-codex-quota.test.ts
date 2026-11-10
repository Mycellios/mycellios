import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { nativeCodexQuota } from "./native-codex-quota.js";
import { discoverNativeCodexQuota } from "./native-agent-runtime.js";
it("reads the installed CLI quota without starting a turn or exposing account identity", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "mycellios-quota-"));
  try {
    await writeFile(join(dataDir, "native-agents.json"), JSON.stringify({ codex: { command: process.execPath, args: [fileURLToPath(new URL("./fixtures/native-agent.mjs", import.meta.url)), "codex"] } }));
    const quota = await discoverNativeCodexQuota(dataDir);
    expect(quota?.windows).toEqual([{ id: "primary", label: "Weekly", usedPercent: 8, durationMinutes: 10080, resetsAt: new Date(1900000000000).toISOString(), model: null }]);
    expect(JSON.stringify(quota)).not.toContain("private-account");
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});
it("does not turn missing or malformed quota into an allowance", () => {
  for (const value of [null, {}, { rateLimits: { primary: { usedPercent: -1 } } }, { rateLimits: { primary: { usedPercent: NaN } } }]) expect(nativeCodexQuota(value)).toBeNull();
  const quota = nativeCodexQuota({ rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: NaN }, secondary: { usedPercent: 9, windowDurationMins: 10080 } } });
  expect(quota?.windows.map(w => [w.usedPercent, w.durationMinutes, w.resetsAt])).toEqual([[100, 300, null], [9, 10080, null]]);
});

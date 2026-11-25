import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeCodexUsageState, readNativeCodexUsage, resetNativeUsageCache } from "./native-usage.js";

const fixture = fileURLToPath(new URL("./fixtures/native-agent.mjs", import.meta.url));

afterEach(() => resetNativeUsageCache());

describe("Codex plan usage on the PC", () => {
  it("keeps only allowlisted limit fields, never the CLI's account identity", async () => {
    const usage = await readNativeCodexUsage({ command: process.execPath, args: [fixture, "codex"] });
    expect(usage).toMatchObject({ credentialId: "native:codex", label: "ChatGPT", plan: "plus",
      windows: [{ id: "primary", label: "Weekly", usedPercent: 8, durationMinutes: 10080 }] });
    expect(JSON.stringify(usage)).not.toContain("private-account");
  });

  it("answers nothing when the CLI cannot be read", async () => {
    expect(await readNativeCodexUsage({ command: process.execPath, args: ["--definitely-not-a-cli"] })).toBeNull();
  });

  it("reuses a reading for a minute and keeps the last one while a slow read runs", async () => {
    let now = 1_000;
    const command = { command: "/bin/codex" };
    const reading = { credentialId: "native:codex" } as never;
    const read = vi.fn(async () => reading);
    expect(await nativeCodexUsageState(command, { read, now: () => now })).toBe(reading);
    now += 30_000;
    expect(await nativeCodexUsageState(command, { read, now: () => now })).toBe(reading);
    expect(read).toHaveBeenCalledTimes(1);
    now += 31_000;
    read.mockImplementationOnce(() => new Promise(() => {}));
    expect(await nativeCodexUsageState(command, { read, now: () => now, waitMs: 5 })).toBe(reading);
    expect(read).toHaveBeenCalledTimes(2);
  });
});

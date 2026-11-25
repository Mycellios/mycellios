import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeModelCatalog, probeNativeModels, resetNativeModelCatalogCache } from "./native-model-catalog.js";

const fixture = fileURLToPath(new URL("./fixtures/native-agent.mjs", import.meta.url));
const claude = { command: process.execPath, args: [fixture, "claude"] };
const model = { id: "opus", label: "Opus", isDefault: false, thinkingLevels: ["high"], fast: false };
afterEach(() => resetNativeModelCatalogCache());

describe("probeNativeModels", () => {
  it("reads Claude Code's catalog from initialize without its account details", async () => {
    const models = await probeNativeModels("claude", claude);
    expect(models.map(entry => [entry.id, entry.isDefault, entry.thinkingLevels])).toEqual([
      ["default", true, ["low", "high"]], ["fixture-claude", false, ["low", "high"]], ["fixture-plain", false, []],
    ]);
    expect(JSON.stringify(models)).not.toContain("synthetic-private-account");
  }, 15000);
});

describe("nativeModelCatalog", () => {
  it("reuses a fresh catalog instead of starting the CLI again", async () => {
    let now = 0;
    const probe = vi.fn().mockResolvedValue([model]);
    expect(await nativeModelCatalog("claude", claude, { probe, now: () => now })).toEqual([model]);
    now += 60_000;
    expect(await nativeModelCatalog("claude", claude, { probe, now: () => now })).toEqual([model]);
    expect(probe).toHaveBeenCalledTimes(1);
    now += 5 * 60_000;
    probe.mockResolvedValueOnce([]);
    expect(await nativeModelCatalog("claude", claude, { probe, now: () => now })).toEqual([]);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("answers unknown for a slow first read and keeps its result for the next one", async () => {
    let finish!: (value: typeof model[]) => void;
    const probe = vi.fn(() => new Promise<typeof model[]>(resolve => { finish = resolve; }));
    expect(await nativeModelCatalog("codex", claude, { probe, waitMs: 5 })).toBeUndefined();
    finish([model]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(await nativeModelCatalog("codex", claude, { probe, waitMs: 5 })).toEqual([model]);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("treats a failing read as unknown, never as an empty catalog", async () => {
    const probe = vi.fn(async () => { throw new Error("spawn failed"); });
    expect(await nativeModelCatalog("claude", claude, { probe })).toBeUndefined();
  });
});

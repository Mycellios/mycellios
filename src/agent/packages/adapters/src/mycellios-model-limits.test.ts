import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearMycelliosModelLimits,
  parseMycelliosModelLimits,
  readMycelliosModelLimits,
} from "./mycellios-model-limits.js";

const BASE = "https://www.mycellios.com/v1";
const catalog = {
  object: "list",
  data: [
    { id: "network/qwen", processing: "network" },
    {
      id: "mycellios/managed/deepseek",
      processing: "external",
      context_length: 41_454,
      max_input_tokens: 33_262,
      max_output_tokens: 8_192,
    },
    { id: "broken", context_length: -1, max_output_tokens: 8 },
  ],
};
const ok = () => new Response(JSON.stringify(catalog), { headers: { "content-type": "application/json" } });

afterEach(() => clearMycelliosModelLimits());

describe("Mycellios model limits", () => {
  it("reads each route's own window and output bound, omitting routes without one", () => {
    const limits = parseMycelliosModelLimits(catalog);
    expect(limits.get("mycellios/managed/deepseek")).toEqual({ contextWindow: 41_454, maxTokens: 8_192 });
    expect(limits.has("network/qwen")).toBe(false);
    expect(limits.has("broken")).toBe(false);
  });

  it("caches one read-only catalog request per endpoint and key", async () => {
    const fetch = vi.fn(async () => ok());
    await readMycelliosModelLimits(BASE, "key", "mycellios/managed/deepseek", { fetch, now: 0 });
    const again = await readMycelliosModelLimits(BASE, "key", "network/qwen", { fetch, now: 1_000 });
    expect(again).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe(`${BASE}/models`);
    expect(init.method).toBe("GET");
  });

  it("falls back to the saved connection when the catalog cannot be read, and retries later", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(ok());
    expect(await readMycelliosModelLimits(BASE, "key", "mycellios/managed/deepseek", { fetch, now: 0 })).toBeUndefined();
    expect(await readMycelliosModelLimits(BASE, "key", "mycellios/managed/deepseek", { fetch, now: 1 })).toEqual({
      contextWindow: 41_454,
      maxTokens: 8_192,
    });
  });

  it("keeps the last good window when a later refresh fails instead of shrinking to the default", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(ok());
    expect(await readMycelliosModelLimits(BASE, "key", "mycellios/managed/deepseek", { fetch, now: 0 })).toMatchObject({ contextWindow: 41_454 });
    // After the cache lifetime, the refresh fails: the previous read still answers.
    expect(await readMycelliosModelLimits(BASE, "key", "mycellios/managed/deepseek", { fetch, now: 6 * 60_000 })).toMatchObject({ contextWindow: 41_454 });
    // The failed refresh is not cached; the next run asks again.
    await readMycelliosModelLimits(BASE, "key", "mycellios/managed/deepseek", { fetch, now: 6 * 60_000 + 1 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

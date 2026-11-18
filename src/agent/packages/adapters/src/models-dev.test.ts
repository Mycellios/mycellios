import { describe, expect, it, vi } from "vitest";
import {
  fetchModelsDev,
  MODELS_DEV_ENDPOINT,
  ModelsDevCatalog,
  modelsDevName,
  parseModelsDev,
} from "./models-dev.js";

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const PAYLOAD = {
  anthropic: {
    id: "anthropic",
    models: {
      "claude-fable-5-2": {
        name: "Claude Fable 5.2",
        family: "claude-fable",
        release_date: "2026-11-12",
        tool_call: true,
        reasoning: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_000_000, output: 128_000 },
        cost: { input: 10, output: 50, cache_read: 1, cache_write: 12.5 },
      },
      "claude-old": { name: "Old", release_date: "2023-01", status: "deprecated" },
      "claude-image": {
        release_date: "2026-01-01",
        modalities: { input: ["text"], output: ["image"] },
      },
      "no-tools": { release_date: "2026-01-01", tool_call: false },
      "bad id with spaces": { release_date: "2026-01-01" },
    },
  },
  openrouter: {
    models: {
      "anthropic/claude-fable-5.2": { name: "Fable", release_date: "2026-11-10", tool_call: true },
    },
  },
  broken: { models: "nope" },
};

describe("parseModelsDev", () => {
  it("reads releases, capabilities, limits and prices", () => {
    const snapshot = parseModelsDev(PAYLOAD)!;
    expect(snapshot.knowsService("anthropic")).toBe(true);
    expect(snapshot.knowsService("broken")).toBe(false);
    expect(snapshot.model("anthropic", "claude-fable-5-2")).toEqual({
      service: "anthropic",
      id: "claude-fable-5-2",
      name: "Claude Fable 5.2",
      family: "claude-fable",
      releaseDate: "2026-11-12",
      agentReady: true,
      reasoning: true,
      images: true,
      contextWindow: 1_000_000,
      maxOutput: 128_000,
      cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
    });
    expect(snapshot.model("anthropic", "bad id with spaces")).toBeUndefined();
  });

  it("marks deprecated, non-text and tool-less models as not agent-ready", () => {
    const snapshot = parseModelsDev(PAYLOAD)!;
    expect(snapshot.model("anthropic", "claude-old")).toMatchObject({
      agentReady: false,
      releaseDate: "2023-01-01",
    });
    expect(snapshot.model("anthropic", "claude-image")?.agentReady).toBe(false);
    expect(snapshot.model("anthropic", "no-tools")?.agentReady).toBe(false);
  });

  it("merges a name shared across services with the first release date", () => {
    const snapshot = parseModelsDev(PAYLOAD)!;
    expect(snapshot.releaseByName("claude-fable-5.2")).toEqual({
      family: "claude-fable",
      agentReady: true,
      releaseDate: "2026-11-10",
    });
    expect(modelsDevName("openai/gpt-6.1-sol")).toBe("gpt-6-1-sol");
  });

  it("rejects payloads without a usable service", () => {
    expect(parseModelsDev(null)).toBeUndefined();
    expect(parseModelsDev([])).toBeUndefined();
    expect(parseModelsDev({ broken: { models: {} } })).toBeUndefined();
  });
});

describe("fetchModelsDev", () => {
  it("reads the public catalog without credentials", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okResponse(PAYLOAD));
    const snapshot = await fetchModelsDev(fetchImpl);
    expect(snapshot?.knowsService("anthropic")).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(MODELS_DEV_ENDPOINT);
    expect(new Headers(init?.headers).get("authorization")).toBeNull();
  });

  it("returns undefined for failures and oversized bodies", async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => new Response("nope", { status: 502 }),
      async () => okResponse("not json"),
      async () =>
        new Response(null, { status: 200, headers: { "content-length": String(64 * 1024 * 1024) } }),
      async () => {
        throw new Error("offline");
      },
    ];
    for (const respond of cases) {
      await expect(fetchModelsDev(respond)).resolves.toBeUndefined();
    }
  });
});

describe("ModelsDevCatalog", () => {
  it("fetches once, serves the copy and refreshes after the TTL", async () => {
    let now = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => okResponse(PAYLOAD));
    const catalog = new ModelsDevCatalog({ enabled: true, fetch: fetchImpl, now: () => now, ttlMs: 1_000 });
    expect(catalog.current()).toBeUndefined();
    expect((await catalog.read())?.knowsService("anthropic")).toBe(true);
    await catalog.read();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now = 2_000;
    await catalog.read();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });

  it("keeps the last good copy through failures until it is too old", async () => {
    let now = 0;
    let fail = false;
    const catalog = new ModelsDevCatalog({
      enabled: true,
      fetch: async () => (fail ? new Response("down", { status: 500 }) : okResponse(PAYLOAD)),
      now: () => now,
      ttlMs: 1_000,
      failureTtlMs: 1_000,
      staleMaxAgeMs: 10_000,
    });
    await catalog.read();
    fail = true;
    now = 5_000;
    expect(await catalog.read()).toBeDefined();
    now = 20_000;
    expect(await catalog.read()).toBeUndefined();
    expect(catalog.current()).toBeUndefined();
  });

  it("never fetches while live catalogs are off, but serves an installed copy", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okResponse(PAYLOAD));
    const catalog = new ModelsDevCatalog({ enabled: false, fetch: fetchImpl });
    expect(await catalog.read()).toBeUndefined();
    catalog.install(parseModelsDev(PAYLOAD));
    expect((await catalog.read())?.knowsService("anthropic")).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bounds the wait for a first copy", async () => {
    const catalog = new ModelsDevCatalog({
      enabled: true,
      fetch: () => new Promise<Response>(() => undefined),
    });
    await expect(catalog.read(10)).resolves.toBeUndefined();
  });
});

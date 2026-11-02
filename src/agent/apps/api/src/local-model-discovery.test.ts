import { describe, expect, it, vi } from "vitest";
import { discoverLocalModels } from "./local-model-discovery.js";

describe("local model discovery", () => {
  it("uses fixed loopback endpoints, rejects redirects and deduplicates model IDs", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ data: [{ id: "fixture" }, { id: "fixture" }, { id: 7 }] }),
    );
    const rows = await discoverLocalModels(undefined, fetcher);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.modelIds).toEqual(["fixture"]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:11434/v1/models",
      "http://127.0.0.1:1234/v1/models",
    ]);
  });
  it("tolerates unavailable servers and rejects oversized replies", async () => {
    const fetcher = vi.fn(async () => new Response("x".repeat(256001)));
    await expect(discoverLocalModels(undefined, fetcher)).resolves.toEqual([]);
    await expect(
      discoverLocalModels(
        undefined,
        vi.fn(async () => {
          throw new Error("offline");
        }),
      ),
    ).resolves.toEqual([]);
  });
});

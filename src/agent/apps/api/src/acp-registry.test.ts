import { expect, it, vi } from "vitest";
import { createAcpRegistry } from "./acp-registry.js";

it("coalesces public metadata requests and strips executable distribution data", async () => {
  const fetcher = vi.fn(async () => Response.json({ agents: [
    { id: "opencode", name: "OpenCode", version: "1.0.0", distribution: { command: "untrusted" } },
    { id: "../bad", name: "Invalid", version: "1.0.0" },
  ] }));
  const registry = createAcpRegistry(fetcher);
  const expected = [{ id: "opencode", name: "OpenCode", version: "1.0.0" }];
  expect(await Promise.all([registry(), registry()])).toEqual([expected, expected]);
  expect(await registry()).toEqual(expected);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json",
    expect.objectContaining({ redirect: "error", credentials: "omit" }),
  );
});

it("allows retry after an upstream failure", async () => {
  const fetcher = vi.fn(async () => Response.json({ agents: [] }));
  fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
  const registry = createAcpRegistry(fetcher);
  await expect(registry()).rejects.toThrow("ACP registry unavailable");
  await expect(registry()).resolves.toEqual([]);
});

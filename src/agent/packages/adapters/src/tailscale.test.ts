import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@rakazo/db";
import { TailnetService } from "./tailscale.js";
import * as remote from "./remote-mcp.js";

afterEach(() => vi.restoreAllMocks());

const scope = { spaceId: "space-a", userId: "user-a", botId: "mico-a" };
const server = { id: "mcp-a", endpoint: "https://mcp.tail123.ts.net/mcp", networkId: "network-a" };
function fixture() {
  const row = { id: "network-a", ...scope, kind: "personal", name: "Home", dnsSuffix: "tail123.ts.net",
    enabled: true, generation: 0, allowedBotIds: ["mico-a"] };
  const prisma = {
    spaceMember: { findFirst: vi.fn(async () => ({ role: "member" })) },
    tailnetConnection: {
      findFirst: vi.fn(async ({ where }: { where: { spaceId: string; userId: string } }) => where.spaceId === scope.spaceId && where.userId === scope.userId ? row : null),
      update: vi.fn(async ({ data }: { data: { enabled?: boolean; generation?: { increment: number } } }) => { Object.assign(row, data, data.generation ? { generation: row.generation + 1 } : {}); return row; }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    tailnetPolicy: { findFirst: vi.fn<(...args: unknown[]) => Promise<{ enabled: boolean } | null>>(async () => null) },
    bot: { findFirst: vi.fn(async () => ({ id: "mico-a" })) },
    mcpServer: { findFirst: vi.fn(async () => server) },
    botMcpServer: { findFirst: vi.fn(async () => ({ id: "assignment-a" })) },
  };
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{"jsonrpc":"2.0","result":{}}', { headers: { "content-type": "application/json" } }));
  return { row, prisma, fetch, service: new TailnetService(prisma as unknown as PrismaClient, { url: "http://gateway", key: "a".repeat(32), fetch }) };
}
describe("private MCP authorization", () => {
  it("requires both network and MCP assignments before any network call", async () => {
    const f = fixture();
    await expect(f.service.authorize("network-a", scope, server)).resolves.toBe(f.row);
    f.prisma.botMcpServer.findFirst.mockResolvedValue(null as never);
    await expect(f.service.authorize("network-a", scope, server)).rejects.toThrow("not assigned");
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each([{ ...scope, userId: "other" }, { ...scope, spaceId: "other" }, { ...scope, botId: "other" }])("refuses another owner, Space or Mico: %o", async actor => {
    const f = fixture();
    await expect(f.service.authorize("network-a", actor, server)).rejects.toThrow(/authorized/);
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("revalidates cached transports after grants and membership are revoked", async () => {
    const f = fixture();
    const transport = await f.service.transport("network-a", scope, server);
    f.row.allowedBotIds = [];
    await expect(transport.managedFetch!(server.endpoint)).rejects.toThrow("not authorized");
    f.row.allowedBotIds = ["mico-a"];
    f.prisma.spaceMember.findFirst.mockResolvedValue(null as never);
    await expect(transport.managedFetch!(server.endpoint)).rejects.toThrow("not authorized");
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("requires the company policy at execution", async () => {
    const f = fixture(); f.row.kind = "company";
    f.prisma.tailnetPolicy.findFirst.mockResolvedValue({ enabled: true });
    const transport = await f.service.transport("network-a", scope, server);
    f.prisma.tailnetPolicy.findFirst.mockResolvedValue(null as never);
    await expect(transport.managedFetch!(server.endpoint)).rejects.toThrow("administrator");
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("cannot bypass a company policy by declaring the network personal", async () => {
    const f = fixture(); f.prisma.tailnetPolicy.findFirst.mockResolvedValue({ enabled: false });
    await expect(f.service.authorize("network-a", scope, server)).rejects.toThrow("company connection");
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("routes an allowed request only through the selected gateway device", async () => {
    const f = fixture();
    const transport = await f.service.transport("network-a", scope, server);
    const response = await transport.managedFetch!(server.endpoint, { method: "POST", body: '{"method":"tools/call"}' });
    expect(await response.json()).toHaveProperty("jsonrpc", "2.0");
    expect(f.fetch.mock.calls[0]?.[0]).toBe("http://gateway/nodes/network-a/fetch");
    const init = f.fetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ dnsSuffix: "tail123.ts.net", url: server.endpoint });
  });
  it("does not reuse a transport for a changed MCP/network binding", async () => {
    const f = fixture(); const transport = await f.service.transport("network-a", scope, server);
    f.prisma.mcpServer.findFirst.mockResolvedValue({ ...server, networkId: "network-b" });
    await expect(transport.managedFetch!(server.endpoint)).rejects.toThrow("binding changed");
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("lets the SDK discard a response body without turning cleanup into an abort error", async () => {
    const f = fixture();
    let requestSignal: AbortSignal | undefined;
    let cancelled = false;
    f.fetch.mockImplementation(async (_input, init) => {
      requestSignal = init?.signal ?? undefined;
      return new Response(new ReadableStream({
        cancel() {
          if (requestSignal?.aborted) throw new DOMException("This operation was aborted", "AbortError");
          cancelled = true;
        },
      }), { status: 202 });
    });
    const transport = await f.service.transport("network-a", scope, server);
    const response = await transport.managedFetch!(server.endpoint, { method: "POST", body: '{}' });
    await expect(response.body!.cancel()).resolves.toBeUndefined();
    expect(cancelled).toBe(true);
    expect(requestSignal?.aborted).toBe(true);
  });
  it("keeps cached sessions usable after the previous run's signal ends", async () => {
    const f = fixture(); const previous = new AbortController();
    const transport = await f.service.transport("network-a", { ...scope, signal: previous.signal }, server);
    previous.abort();
    const response = await transport.managedFetch!(server.endpoint, { method: "POST", body: '{}' });
    await response.text();
    const init = f.fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal?.aborted).toBe(false);
  });
  it("does not let a server request another private MCP's origin implicitly", async () => {
    const f = fixture(); const transport = await f.service.transport("network-a", scope, server);
    await expect(transport.managedFetch!("https://other.tail123.ts.net/mcp")).rejects.toThrow("not authorized");
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("bounds public OAuth responses without routing them through a tailnet", async () => {
    const f = fixture();
    const cancel = vi.fn();
    let chunk = 0;
    const publicFetch = Object.assign(vi.fn(async () => new Response(new ReadableStream({
      pull(controller) { if (chunk++ < 4) controller.enqueue(new Uint8Array(1_000_000)); else controller.close(); },
      cancel,
    }))), { close: vi.fn(async () => {}) });
    vi.spyOn(remote, "createSafeRemoteFetch").mockReturnValue(publicFetch);
    const transport = await f.service.transport("network-a", scope, server);
    await expect(transport.managedFetch!("https://login.example.test/token", { method: "POST", body: '{}' })).rejects.toThrow("too large");
    expect(cancel).toHaveBeenCalled();
    expect(publicFetch.close).toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("refuses wrong-tailnet URLs without a public fallback", async () => {
    const f = fixture(); const transport = await f.service.transport("network-a", scope, server);
    await expect(transport.managedFetch!("https://mcp.other.ts.net/mcp")).rejects.toThrow("selected Tailscale");
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("persists disconnection even if device cleanup fails", async () => {
    const f = fixture(); f.fetch.mockRejectedValue(new Error("gateway down"));
    await expect(f.service.disconnect("network-a", scope)).rejects.toThrow();
    expect(f.row.enabled).toBe(false);
    await expect(f.service.authorize("network-a", scope, server)).rejects.toThrow("disconnected");
  });
});

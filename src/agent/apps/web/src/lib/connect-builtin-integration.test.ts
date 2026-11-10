import { beforeEach, expect, it, vi } from "vitest";
import type { RpcClient } from "./rpc";
vi.mock("./mcp-connect", () => ({ connectMcpOauth: vi.fn() }));
import { connectBuiltinIntegration } from "./connect-builtin-integration";
import { BUILTIN_INTEGRATIONS } from "../pages/marketplace/builtin-integrations";
const servers = { list: vi.fn(), create: vi.fn(), update: vi.fn(), test: vi.fn() };
const client = { mcp: { servers } } as unknown as RpcClient;
const auth = vi.fn();
beforeEach(() => { for (const mock of Object.values(servers)) mock.mockReset(); servers.list.mockResolvedValue([]); servers.create.mockResolvedValue({ id: "owned" }); servers.test.mockResolvedValue({ health: { status: "ok" } }); auth.mockReset().mockResolvedValue("connected"); });
it("uses the bound Space client for authorization and verifies before reporting success", async () => {
 const app = BUILTIN_INTEGRATIONS.find(app => app.slug === "linear")!;
 expect(await connectBuiltinIntegration(app, client, undefined, auth)).toBe(true);
 expect(servers.create).toHaveBeenCalledWith(expect.objectContaining({ endpoint: app.endpoint, headers: {} }));
 expect(auth).toHaveBeenCalledExactlyOnceWith("owned", client); expect(servers.test).toHaveBeenCalledWith({ id: "owned" });
});
it("does not approve or report a cancelled or failed connection as connected", async () => {
 const app = BUILTIN_INTEGRATIONS.find(app => app.slug === "linear")!;
 auth.mockResolvedValue("cancelled"); expect(await connectBuiltinIntegration(app, client, undefined, auth)).toBe(false); expect(servers.test).not.toHaveBeenCalled();
 auth.mockResolvedValue("connected"); servers.test.mockResolvedValue({ health: { status: "error", message: "Connection failed" } });
 await expect(connectBuiltinIntegration(app, client, undefined, auth)).rejects.toThrow("Connection failed");
});
it("reuses the existing app and sends keys only through the encrypted server configuration", async () => {
 const app = BUILTIN_INTEGRATIONS.find(app => app.slug === "github")!;
 await expect(connectBuiltinIntegration(app, client, undefined, auth)).rejects.toThrow("API key"); expect(servers.create).not.toHaveBeenCalled();
 servers.list.mockResolvedValue([{ id: "existing", slug: "personal-github", name: "GitHub", description: "", endpoint: app.endpoint, headerKeys: [], enabled: true }]); servers.update.mockResolvedValue({ id: "existing" });
 expect(await connectBuiltinIntegration(app, client, "test-only-key", auth)).toBe(true);
 expect(servers.create).not.toHaveBeenCalled(); expect(auth).not.toHaveBeenCalled();
 expect(servers.update).toHaveBeenCalledWith({ id: "existing", config: expect.objectContaining({ endpoint: app.endpoint, headers: { Authorization: "Bearer test-only-key" } }) });
});

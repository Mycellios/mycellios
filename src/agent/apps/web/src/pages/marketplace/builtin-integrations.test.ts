import type { McpServer } from "@rakazo/contracts";
import { expect, it } from "vitest";
import { BUILTIN_INTEGRATIONS, integrationCatalog } from "./builtin-integrations";
it("provides a local catalog when no managed provider is configured", () => {
 const items = integrationCatalog([], []); expect(items.length).toBe(19);
 expect(items.map(item => item.slug)).toEqual(expect.arrayContaining(["github", "linear", "figma", "canva", "render"]));
 expect(items.every(item => !item.connected && !item.noAuth)).toBe(true);
 expect(BUILTIN_INTEGRATIONS.every(app => app.endpoint.startsWith("https://"))).toBe(true);
});
it("preserves managed connections without duplicating their app", () => {
 const managed = { connectorId: "managed", slug: "linear", name: "Linear", logo: null, connected: true, noAuth: false };
 const items = integrationCatalog([managed], []); expect(items.filter(item => item.slug === "linear")).toEqual([managed]);
});
it("does not call a registered, disabled, failed or unauthorized server connected", () => {
 const app = BUILTIN_INTEGRATIONS.find(app => app.slug === "linear")!;
 const server = { endpoint: app.endpoint, enabled: true, oauthStatus: "connected", health: { status: "ok" } } as McpServer;
 const connected = (value: McpServer) => integrationCatalog([], [value]).find(item => item.slug === "linear")!.connected;
 expect(connected(server)).toBe(true);
 expect(connected({ ...server, enabled: false })).toBe(false);
 expect(connected({ ...server, oauthStatus: "reconnect" })).toBe(false);
 expect(connected({ ...server, health: { ...server.health, status: "error" } })).toBe(false);
});

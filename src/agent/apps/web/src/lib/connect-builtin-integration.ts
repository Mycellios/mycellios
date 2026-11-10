import type { McpServerConfigInput } from "@rakazo/contracts";
import type { BuiltinIntegration } from "../pages/marketplace/builtin-integrations";
import type { RpcClient } from "./rpc";
import { connectMcpOauth } from "./mcp-connect";

/** Uses the bound Space client throughout; registering an app never approves a Mico implicitly. */
export async function connectBuiltinIntegration(app: BuiltinIntegration, client: RpcClient, key?: string,
  authorize = connectMcpOauth) {
  if (app.auth === "key" && !key?.trim()) throw new Error("An API key is required.");
  const existing = (await client.mcp.servers.list()).find(server => server.endpoint === app.endpoint);
  const config: McpServerConfigInput = { slug: existing?.slug ?? `app-${app.slug}`, name: app.name,
    description: existing?.description ?? "", transport: "streamable_http", endpoint: app.endpoint,
    enabled: true, headers: { ...Object.fromEntries((existing?.headerKeys ?? []).map(name => [name, ""])),
      ...(key?.trim() ? { Authorization: `Bearer ${key.trim()}` } : {}) } };
  let server = existing;
  if (!server) server = await client.mcp.servers.create(config);
  else if (key?.trim() || !server.enabled) server = await client.mcp.servers.update({ id: server.id, config });
  if (app.auth === "oauth") {
    const result = await authorize(server.id, client);
    if (result === "cancelled") return false;
    if (result === "authorization_not_requested") throw new Error("The provider did not complete authorization.");
  }
  const tested = await client.mcp.servers.test({ id: server.id });
  if (tested.health.status !== "ok") throw new Error(tested.health.message || "The connection could not be verified.");
  return true;
}

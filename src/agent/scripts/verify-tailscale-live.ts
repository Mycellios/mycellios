import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../packages/db/src/generated/prisma/client.js";
import { TailnetService } from "../packages/adapters/src/tailscale.js";
import { McpConnector } from "../packages/adapters/src/mcp-connector.js";
import { EncryptedSecretStore } from "../packages/adapters/src/secrets.js";

const receipt = "../../build/tailscale-gateway/live/network.json";
const network = JSON.parse(await readFile(receipt, "utf8"));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const tailnets = new TailnetService(prisma, { url: "http://127.0.0.1:8095", key: process.env.TAILSCALE_GATEWAY_KEY! });
const connector = new McpConnector(prisma, new EncryptedSecretStore("isolated-qualification-only"), { tailnets });
const owner = { spaceId: "qualification-space", userId: "qualification-owner" };
const context = (botId = "allowed-mico") => ({ ...owner, botId, operationId: "qualification", traceId: "qualification", signal: AbortSignal.timeout(90_000) });
const counter = () => JSON.parse(execFileSync("docker", ["exec", "tailnet-peer", "node", "-e",
  "fetch('http://127.0.0.1:8081/counter').then(r=>r.text()).then(console.log)"], { encoding: "utf8" })).calls;
const execute = async (ctx = context()) => {
  const events = [];
  for await (const event of connector.execute({ tool: "mcp__private__read", args: {}, executionId: "qualification",
    route: { connectorId: "mcp", resourceId: "private-mcp", toolName: "read" } }, ctx)) events.push(event);
  return events;
};
const blocked = async (ctx: ReturnType<typeof context>, label: string) => {
  const before = counter();
  const events = await execute(ctx);
  assert.ok(events.some(e => e.type === "error"), `${label}: explicit refusal`);
  assert.equal(counter(), before, `${label}: no request reached the private tool`);
};
try {
  const now = new Date();
  await prisma.user.create({ data: { id: owner.userId, name: "Qualification", email: "qualification@example.invalid" } });
  await prisma.organization.create({ data: { id: "qualification-org", name: "Qualification", slug: "qualification", createdAt: now } });
  await prisma.member.create({ data: { id: "qualification-member", organizationId: "qualification-org", userId: owner.userId, role: "owner", createdAt: now } });
  await prisma.space.create({ data: { id: owner.spaceId, organizationId: "qualification-org", name: "Qualification" } });
  await prisma.spaceMember.create({ data: { id: "qualification-membership", ...owner, organizationId: "qualification-org", role: "owner", createdAt: now } });
  for (const id of ["allowed-mico", "denied-mico", "unassigned-mico"]) {
    await prisma.bot.create({ data: { id, ...owner, name: id, color: "green" } });
  }
  await prisma.tailnetConnection.create({ data: { id: network.id, ...owner, name: "Qualification", kind: "personal", dnsSuffix: network.suffix,
    enabled: true, allowedBotIds: ["allowed-mico", "unassigned-mico"] } });
  await prisma.mcpServer.create({ data: { id: "private-mcp", ...owner, name: "Private", slug: "private", transport: "streamable_http", endpoint: network.endpoint, networkId: network.id } });
  for (const botId of ["allowed-mico", "denied-mico"]) {
    await prisma.botMcpServer.create({ data: { ...owner, botId, serverId: "private-mcp" } });
  }
  assert.equal((await tailnets.status(network.id, owner)).status, "connected");
  const tools = await connector.discoverTools(context());
  assert.ok(tools.some(t => t.name === "mcp__private__read"), "authorized Mico discovers private tool");
  const allowed = await execute();
  assert.ok(allowed.some(e => e.type === "result" && JSON.stringify(e).includes("private-tailnet-ok")), JSON.stringify(allowed));
  assert.equal(counter(), 1);
  assert.equal((await connector.discoverTools(context("denied-mico"))).length, 0);
  await blocked(context("denied-mico"), "Mico without network grant");
  await blocked(context("unassigned-mico"), "Mico without MCP assignment");
  await blocked({ ...context(), userId: "other-owner" }, "Different owner");
  await blocked({ ...context(), spaceId: "other-space" }, "Different Space");
  await prisma.botMcpServer.updateMany({ where: { botId: "allowed-mico" }, data: { allowAllTools: false, allowedTools: [] } });
  await blocked(context(), "Tool allowlist");
  await prisma.botMcpServer.updateMany({ where: { botId: "allowed-mico" }, data: { allowAllTools: true } });
  await prisma.tailnetConnection.update({ where: { id: network.id }, data: { allowedBotIds: [] } });
  await blocked(context(), "Revoked network grant on cached session");
  await prisma.tailnetConnection.update({ where: { id: network.id }, data: { allowedBotIds: ["allowed-mico"] } });
  await prisma.tailnetPolicy.create({ data: { spaceId: owner.spaceId, dnsSuffix: network.suffix, enabled: true } });
  await prisma.tailnetConnection.update({ where: { id: network.id }, data: { kind: "company" } });
  assert.ok((await execute()).some(e => e.type === "result"));
  await prisma.tailnetPolicy.updateMany({ where: { spaceId: owner.spaceId }, data: { enabled: false } });
  await blocked(context(), "Revoked company policy");
  await tailnets.reconcile();
  await writeFile(receipt, JSON.stringify({ ...network, passed: true, database: "isolated PostgreSQL", actualMicoConnector: true,
    checks: ["private discovery and execution", "network grant denial", "MCP assignment denial", "owner isolation", "Space isolation", "tool allowlist", "cached-session revocation", "company policy revocation"],
    fullLlmRun: false }, null, 2));
  console.log("PASS: real private MCP execution and all eight scoped admission/revocation checks");
} finally {
  await connector.close(); await tailnets.close(); await prisma.$disconnect();
}

import { expect, it, vi } from "vitest";
import { contributionAccount } from "./contribution-account.js";

it.each(["pause", "resume"] as const)("keeps %s pending until telemetry follows the applied command", async action => {
  let observed: { contributionEnabled: boolean; observedAt: string } | null = {
    contributionEnabled: action === "pause", observedAt: "2026-11-15T08:00:00.000Z",
  };
  const completedAt = "2026-11-15T08:00:02.000Z";
  const transport = vi.fn(async () => Response.json({ data: [{ nodeId: "own-node", status: "active", generation: 7, connected: true,
    observed, commands: [{ type: action, state: "applied", completedAt }] }] }));
  const api = contributionAccount("private-session", transport);
  expect(await api.status("own-node")).toMatchObject({ pending: action, enabled: action === "pause" });
  observed = null;
  expect(await api.status("own-node")).toMatchObject({ pending: action, enabled: null });
  observed = { contributionEnabled: action === "resume", observedAt: "2026-11-15T08:00:03.000Z" };
  expect(await api.status("own-node")).toMatchObject({ pending: null, enabled: action === "resume" });
  // A later actual change must not be hidden forever behind an old ACK.
  observed = { contributionEnabled: action === "pause", observedAt: "2026-11-15T08:00:04.000Z" };
  expect(await api.status("own-node")).toMatchObject({ pending: null, enabled: action === "pause" });
});

it("reports only a rejected Play/Pause command that did not take effect", async () => {
  let commands: { type: string; state: string }[] = [];
  const transport = vi.fn(async () => Response.json({ data: [{ nodeId: "own-node", status: "active", generation: 7, connected: true,
    observed: { contributionEnabled: true }, commands }] }));
  const api = contributionAccount("private-session", transport);
  // A rejected component update must not leave Pause stuck on an error.
  commands = [{ type: "update", state: "rejected" }, { type: "resume", state: "applied" }];
  expect(await api.status("own-node")).toMatchObject({ enabled: true, pending: null, rejected: false });
  commands = [{ type: "pause", state: "rejected" }];
  expect(await api.status("own-node")).toMatchObject({ enabled: true, rejected: true });
  commands = [{ type: "resume", state: "rejected" }];
  expect(await api.status("own-node")).toMatchObject({ enabled: true, rejected: false });
});

function fixture() {
  let command: { type: string; state: string } | undefined;
  const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = String(url).replace("https://www.mycellios.com/v1", "");
    if (route === "/nodes") return Response.json({ data: [{ nodeId: "own-node", status: "active", generation: 7, connected: true, observed: { contributionEnabled: false }, commands: command ? [command] : [] }] });
    if (route === "/account") return Response.json({ user_id: "verified-account" });
    if (route.endsWith("/commands")) { command = { type: JSON.parse(String(init?.body)).type, state: "queued" }; return Response.json({ state: "queued" }, { status: 202 }); }
    if (route === "/nodes/enrollments") return Response.json({ enrollmentId: "4b5e61db-9e21-4268-b1a3-50dd0e818660", enrollmentToken: "t".repeat(43), nonce: "n".repeat(32), expiresAt: "2030-01-01T00:00:00.000Z" });
    if (route.endsWith("/confirm")) return new Response(null, { status: 204 });
    throw new Error("Unexpected route");
  });
  return { transport, api: contributionAccount("private-session", transport as typeof fetch) };
}
it("controls only the matching owned node using its fresh generation and authenticated account", async () => {
  const f = fixture();
  expect(await f.api.control("own-node", "resume")).toMatchObject({ pending: "resume", enabled: false });
  const call = f.transport.mock.calls.find(([url]) => String(url).endsWith("/commands"))!;
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({ actor: { id: "verified-account", scopes: ["node:control"] }, generation: 7, type: "resume" });
  expect(JSON.parse(String(call[1]?.body)).payload).toEqual({ version: 1 });
  expect(call[1]?.redirect).toBe("error");
  await expect(f.api.control("own-node", "resume")).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.transport.mock.calls.filter(([url]) => String(url).endsWith("/commands"))).toHaveLength(1);
});
it("never enrolls, controls or discloses another account's device", async () => {
  const f = fixture();
  await expect(f.api.control("someone-else", "resume")).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(f.transport).toHaveBeenCalledTimes(1);
});
it("issues a confirmed short-lived grant from the session without exposing its access token", async () => {
  const f = fixture(); const grant = await f.api.enroll();
  expect(grant.coordinatorUrl).toBe("https://www.mycellios.com");
  expect(JSON.stringify(grant)).not.toContain("private-session");
  const body = JSON.parse(String(f.transport.mock.calls[1]![1]?.body));
  expect(body).toMatchObject({ accountId: "verified-account", expiresInSeconds: 900 });
  expect(f.transport.mock.calls[2]![0]).toMatch(/\/confirm$/);
});
it("does not follow redirects or reveal upstream credentials and diagnostics", async () => {
  const transport = vi.fn(async () => new Response("private-diagnostic", { status: 401 }));
  await expect(contributionAccount("secret", transport).status("own-node")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(transport).toHaveBeenCalledTimes(1);
});
it("redacts transport exceptions instead of relaying private request details", async () => {
  const transport = vi.fn(async () => { throw new Error("private-token-in-transport-diagnostic"); });
  const failure = await contributionAccount("secret", transport).status("own-node").catch(error => error);
  expect(failure).toMatchObject({ code: "SERVICE_UNAVAILABLE", message: "Contribution could not be confirmed. Refresh before trying again." });
  expect(failure.cause.message).toBe("lookup failure Error");
  expect(JSON.stringify(failure)).not.toContain("private-token");
});
it("keeps only the authority status as the cause of an unavailable lookup", async () => {
  const transport = vi.fn(async () => new Response("private-diagnostic", { status: 502 }));
  const failure = await contributionAccount("secret", transport).status("own-node").catch(error => error);
  expect(failure).toMatchObject({ code: "SERVICE_UNAVAILABLE", status: 503 });
  expect(failure.cause.message).toBe("HTTP 502");
});

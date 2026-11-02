import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createRunSandbox } from "../../../packages/adapters/src/host-aware-sandbox.js";
import { expect, it } from "vitest";
import { mountDesktopRelay } from "./desktop-relay.js";
import { AccountComputerConnection } from "../../desktop/src/account-computer.js";
import { computerConsentScope } from "../../desktop/src/host-computer.js";
import { startHostComputerServer } from "../../../packages/adapters/src/host-computer-server.js";
import { desktopRelayKey, signDesktopRelay } from "../../../packages/adapters/src/desktop-relay.js";

it("serves never-opened agents in different Spaces from server jobs, without a renderer or per-chat consent", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mc-account-access-"));
  const app = new Hono(),
    secret = "fixture-account-secret",
    token = "b".repeat(64);
  let userId = "owner",
    allowed = true;
  const spaces = ["one", "two"];
  const server = await startHostComputerServer({
    root: path.join(root, "workspaces"),
    token,
    hostname: "127.0.0.1",
  });
  const close = mountDesktopRelay(app, {
    enabled: true,
    secret,
    authenticate: async (request) => ({
      actor: {
        userId,
        spaceId: request.headers.get("x-rakazo-space-id") ?? "one",
        email: "fixture@example.test",
        isDeploymentOwner: false,
      },
      sessionId: userId + "-native-session",
    }),
    spaces: async () => spaces,
    ownsBot: async (scope, bot) =>
      scope.userId === "owner" &&
      ((scope.spaceId === "one" && ["remote-one", "another-one"].includes(bot)) ||
        (scope.spaceId === "two" && bot === "remote-two")),
  });
  const listener = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  if (!listener.listening)
    await new Promise<void>((resolve) => listener.once("listening", resolve));
  const address = listener.address();
  if (!address || typeof address === "string") throw Error("No listener");
  const base = `http://127.0.0.1:${address.port}`;
  const scope = computerConsentScope(base, { userId });
  await writeFile(path.join(root, "host-computer-account-consent"), scope);
  const host = {
    isEnabled: () => enabled,
    activate: (value: boolean) => {
      enabled = value;
      server.setEnabled(value);
    },
    grant: async () => {},
    hasRememberedAccess: (value: string) => allowed && value === scope,
  };
  let enabled = false;
  const bodies: string[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    if (typeof init?.body === "string") bodies.push(init.body);
    return globalThis.fetch(url, init);
  };
  const connection = new AccountComputerConnection({
    profile: root,
    host,
    context: async () => ({ base, fetch }),
    localUrl: `http://127.0.0.1:${server.port}`,
    localToken: token,
    consentScope: computerConsentScope,
  });
  const dispatch = async (spaceId: string, botId: string, request?: unknown) => {
    const body = JSON.stringify({
      scope: { userId: "owner", spaceId },
      nonce: randomUUID(),
      ...(request ? { request } : { probe: botId }),
    });
    const time = String(Date.now());
    return app.request("/api/desktop-relay/internal", {
      method: "POST",
      headers: {
        "x-desktop-time": time,
        "x-desktop-signature": signDesktopRelay(desktopRelayKey(secret), time, body),
      },
      body,
    });
  };
  try {
    connection.start();
    await connection.refresh();
    expect(connection.online()).toBe(true);
    for (const [space, bot] of [
      ["one", "remote-one"],
      ["two", "remote-two"],
      ["one", "another-one"],
    ]) {
      expect(await (await dispatch(space!, bot!)).json()).toEqual({ available: true });
      const response = await dispatch(space!, bot!, { method: "provision", botId: bot });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('"kind":"desktop"');
    }
    const sandbox = createRunSandbox("none", {
      dataDir: root,
      desktopRelay: { url: base + "/api/desktop-relay/internal", key: desktopRelayKey(secret) },
    });
    const context = {
      userId: "owner",
      spaceId: "one",
      botId: "another-one",
      operationId: "worker",
      traceId: "worker",
      runId: "worker-fixture",
      signal: new AbortController().signal,
    };
    expect(await sandbox.provisionKind?.(context)).toBe("desktop");
    const computer = await sandbox.provision({ botId: context.botId, homePath: "" }, context);
    const events = [];
    for await (const event of sandbox.execute(
      computer,
      { argv: [process.execPath, "-e", 'console.log("account-pc-worker-ok")'] },
      context,
    ))
      events.push(event);
    expect(JSON.stringify(events)).toContain("account-pc-worker-ok");
    const denied = await dispatch("two", "remote-one");
    expect(denied.status).toBe(404);
    expect(bodies.every((body) => !body.includes(token))).toBe(true);
    // UI account/Space changes do not select the execution target; the authenticated owner still does.
    userId = "someone-else";
    await connection.refresh();
    expect(connection.online()).toBe(false);
    expect(enabled).toBe(false);
    userId = "owner";
    await connection.refresh();
    expect(connection.online()).toBe(true);
    allowed = false;
    await connection.refresh();
    expect(connection.online()).toBe(false);
    expect(enabled).toBe(false);
  } finally {
    connection.stop();
    close();
    await server.close();
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  }
}, 45000);

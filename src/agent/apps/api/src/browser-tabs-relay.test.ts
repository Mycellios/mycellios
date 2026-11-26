import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { browserTabsKey, signBrowserTabs } from "../../../packages/adapters/src/browser-tabs-relay.js";
import { browserSessionKey, mountBrowserTabsRelay } from "./browser-tabs-relay.js";

const EXTENSION = "chrome-extension://bnbdbnbloaeblmjpoknddcffkmpfhmgg";
const SECRET = "test-secret";
const generation = "11111111-1111-4111-8111-111111111111";

function setup(sessionId: string | null = "session-1") {
  const app = new Hono();
  const stop = mountBrowserTabsRelay(app, {
    enabled: true,
    secret: SECRET,
    authenticate: async () => (sessionId ? { userId: "user-1", sessionId } : null),
  });
  const panel = (action: string, body: unknown, headers: Record<string, string> = { origin: EXTENSION, "x-mycellios-extension": "1" }) =>
    app.request(`/api/browser-tabs/${action}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const worker = (payload: Record<string, unknown>, key = browserTabsKey(SECRET)) => {
    const body = JSON.stringify({ ...payload, nonce: randomUUID() });
    const timestamp = String(Date.now());
    return app.request("/api/browser-tabs/internal", {
      method: "POST",
      headers: { "content-type": "application/json", "x-browser-tabs-time": timestamp, "x-browser-tabs-signature": signBrowserTabs(key, timestamp, body) },
      body,
    });
  };
  return { app, stop, panel, worker };
}

describe("browser tabs routes", () => {
  let stop: (() => void) | undefined;
  afterEach(() => stop?.());

  it("accepts only the extension origin with its header", async () => {
    const relay = setup();
    stop = relay.stop;
    const register = { generation, capabilities: { tabs: 1 } };
    expect((await relay.panel("register", register, { origin: "https://www.mycellios.com", "x-mycellios-extension": "1" })).status).toBe(403);
    expect((await relay.panel("register", register, { origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "x-mycellios-extension": "1" })).status).toBe(403);
    expect((await relay.panel("register", register, { origin: EXTENSION })).status).toBe(403);
    const accepted = await relay.panel("register", register);
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("requires a signed-in session", async () => {
    const relay = setup(null);
    stop = relay.stop;
    expect((await relay.panel("register", { generation, capabilities: { tabs: 1 } })).status).toBe(401);
  });

  it("lists tabs for the session that registered and refuses others", async () => {
    const relay = setup();
    stop = relay.stop;
    const scope = { userId: "user-1", sessionKey: browserSessionKey("session-1") };
    expect(await (await relay.worker({ scope, probe: "tabs" })).json()).toEqual({ available: false });
    await relay.panel("register", { generation, capabilities: { tabs: 1 } });
    expect(await (await relay.worker({ scope, probe: "tabs" })).json()).toEqual({ available: true });
    expect(await (await relay.worker({ scope: { ...scope, sessionKey: browserSessionKey("phone") }, probe: "tabs" })).json()).toEqual({ available: false });

    const listing = relay.worker({ scope, request: { op: "list" } });
    const poll = await (await relay.panel("poll", { generation, wait: true })).json() as { operations: { id: string }[] };
    expect(poll.operations).toHaveLength(1);
    const tabs = [{ tab: "t1", title: "Docs", url: "https://docs.example/a", active: true, audible: false }];
    expect((await relay.panel("result", { generation, id: poll.operations[0]!.id, result: { tabs, omitted: 0 } })).status).toBe(200);
    expect(await (await listing).json()).toEqual({ result: { tabs, omitted: 0 } });

    await relay.panel("revoke", { generation });
    const refused = await relay.worker({ scope, request: { op: "list" } });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "chrome_not_shared" });
  });

  it("rejects an unsigned worker request", async () => {
    const relay = setup();
    stop = relay.stop;
    const scope = { userId: "user-1", sessionKey: browserSessionKey("session-1") };
    expect((await relay.worker({ scope, probe: "tabs" }, "wrong")).status).toBe(401);
  });
});

import { createHash } from "node:crypto";
import { getLogger } from "@mycellios/logging";
import { BROWSER_EXTENSION_ORIGINS } from "@mycellios/contracts/content-security-policy";
import type { Hono } from "hono";
import {
  BROWSER_TABS_MAX_BYTES,
  parseBrowserTabsDispatch,
  parseBrowserTabsPoll,
  parseBrowserTabsRegister,
  parseBrowserTabsResult,
} from "../../../../contracts/browser-tabs-bridge.js";
import {
  BrowserTabsBroker,
  BrowserTabsError,
  browserTabsKey,
  verifyBrowserTabs,
} from "../../../packages/adapters/src/browser-tabs-relay.js";
import { readBoundedBody } from "./http-body.js";

/** The key a run records for the browser session that sent the owner's message. */
export const browserSessionKey = (sessionId: string) => createHash("sha256").update(sessionId).digest("hex");

const EXTENSION_ORIGINS = new Set<string>(BROWSER_EXTENSION_ORIGINS);

/**
 * Chrome tab sharing (specs/agent-chrome-tabs). Fixed routes for the official extension's
 * side panel, authenticated by the browser's own first-party session, plus a signed route
 * for the worker. Only the exact extension origins with the extension header are accepted
 * and no CORS grant is sent, so a page on the site (even a script injected into the hosted
 * app) or another extension cannot register a browser or answer an operation.
 */
export function mountBrowserTabsRelay(
  app: Hono,
  deps: {
    enabled: boolean;
    secret: string;
    authenticate(request: Request): Promise<{ userId: string; sessionId: string } | null>;
  },
) {
  const broker = new BrowserTabsBroker();
  const key = browserTabsKey(deps.secret);
  const replay = new Map<string, number>();

  app.post("/api/browser-tabs/internal", async (c) => {
    c.header("cache-control", "no-store");
    const body = await readBoundedBody(c.req.raw, BROWSER_TABS_MAX_BYTES);
    if (body === null) return c.json({ error: "Too large" }, 413);
    if (!verifyBrowserTabs(key, c.req.header("x-browser-tabs-time") ?? "", body, c.req.header("x-browser-tabs-signature") ?? ""))
      return c.json({ error: "Unauthorized" }, 401);
    let input: ReturnType<typeof parseBrowserTabsDispatch>;
    try {
      input = parseBrowserTabsDispatch(JSON.parse(body));
    } catch {
      return c.json({ error: "Invalid request" }, 400);
    }
    for (const [nonce, expires] of replay) if (expires < Date.now()) replay.delete(nonce);
    if (replay.has(input.nonce) || replay.size >= 10_000) return c.json({ error: "Duplicate request" }, 409);
    replay.set(input.nonce, Date.now() + 60_000);
    if (!deps.enabled) return c.json({ available: false }, 404);
    if (input.probe) return c.json({ available: broker.available(input.scope, input.probe) });
    try {
      return c.json({ result: await broker.dispatch(input.scope, input.request!, c.req.raw.signal) });
    } catch (error) {
      if (error instanceof BrowserTabsError) return c.json({ error: error.message, code: error.code }, error.status);
      throw error;
    }
  });

  app.post("/api/browser-tabs/:action", async (c) => {
    c.header("cache-control", "no-store");
    if (!deps.enabled) return c.json({ error: "Unavailable" }, 404);
    if (!EXTENSION_ORIGINS.has(c.req.header("origin") ?? "") || c.req.header("x-mycellios-extension") !== "1")
      return c.json({ error: "Extension required" }, 403);
    const session = await deps.authenticate(c.req.raw);
    if (!session) return c.json({ error: "Sign in again" }, 401);
    const owner = { userId: session.userId, sessionKey: browserSessionKey(session.sessionId) };
    const body = await readBoundedBody(c.req.raw, BROWSER_TABS_MAX_BYTES);
    if (body === null) return c.json({ error: "Too large" }, 413);
    const action = c.req.param("action");
    try {
      const input: unknown = JSON.parse(body);
      switch (action) {
        case "register": {
          const value = parseBrowserTabsRegister(input);
          broker.register(owner, value.generation, value.capabilities);
          return c.json({ ok: true, leaseMs: 90_000 });
        }
        case "poll": {
          const value = parseBrowserTabsPoll(input);
          return c.json(await broker.waitPoll(owner, value.generation, c.req.raw.signal, value.wait));
        }
        case "result": {
          const value = parseBrowserTabsResult(input);
          broker.result(owner, value.generation, value.id, value.result);
          return c.json({ ok: true });
        }
        case "release":
          broker.release(owner, parseBrowserTabsPoll(input).generation);
          return c.json({ ok: true });
        case "revoke":
          parseBrowserTabsPoll(input);
          broker.revoke(owner);
          return c.json({ ok: true });
        default:
          return c.json({ error: "Unavailable" }, 404);
      }
    } catch (error) {
      // Codes only: never titles, addresses or page content.
      const reason = error instanceof BrowserTabsError ? "not_registered" : "invalid_request";
      if (!c.req.raw.signal.aborted)
        getLogger().warn("browser_tabs.request_rejected", { "browser_tabs.action": action, "browser_tabs.reason": reason });
      return c.json({ error: "Tab sharing stopped. Turn it on again in the side panel.", code: reason }, 409);
    }
  });

  return () => broker.close();
}

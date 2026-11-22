import { createHash, createHmac } from "node:crypto";
import { productAppUrl } from "@mycellios/contracts";
import {
  SIGNUP_INVITE_COOKIE,
  SIGNUP_INVITE_COOKIE_MAX_AGE_SECONDS,
  signupInviteCodeFromCookie,
  signupInviteCodeMatches,
} from "@mycellios/db";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "./env.js";

type InviteEnv = Pick<AppEnv, "signupInvite" | "authUrl" | "webOrigin">;
const proofLifetimeSeconds = 300;

/**
 * `GET /api/invite/<code>` is the link an operator shares for a closed beta. It only stores
 * the code in an HttpOnly cookie and opens sign-in; account creation checks the code again
 * and claims one of its places. Unknown codes answer like any missing page.
 */
export function signupInviteHttp(env: InviteEnv): Hono {
  const app = new Hono();
  app.post("/api/invite/proof", bodyLimit({ maxSize: 1024 }), async (c) => {
    c.header("cache-control", "no-store");
    const invite = env.signupInvite;
    if (
      !invite ||
      c.req.header("origin") !== new URL(env.webOrigin).origin ||
      !signupInviteCodeMatches(signupInviteCodeFromCookie(c.req.header("cookie")), invite)
    ) {
      return c.notFound();
    }
    const body: unknown = await c.req.json().catch(() => null);
    const address = body && typeof body === "object" && "email" in body ? body.email : undefined;
    const email = typeof address === "string" ? address.trim().toLowerCase() : "";
    if (!email || Buffer.byteLength(email) > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) {
      return c.json({ error: "invalid_email" }, 400);
    }
    const expiry = Math.floor(Date.now() / 1000) + proofLifetimeSeconds;
    const key = createHash("sha256").update(`mycellios:primary-signup:key:v1:${invite.code}`).digest();
    const signature = createHmac("sha256", key)
      .update(`mycellios:primary-signup:proof:v1:${expiry}:${email}`)
      .digest("hex");
    return c.json({ proof: `${expiry}.${signature}` });
  });
  app.get("/api/invite/:code", (c) => {
    const invite = env.signupInvite;
    const code = c.req.param("code");
    if (!invite || !signupInviteCodeMatches(code, invite)) return c.notFound();
    // Same path as the auth cookies, so the sign-up and OIDC callback requests carry it.
    const path = new URL(env.authUrl).pathname.replace(/\/api\/auth\/?$/, "") || "/";
    const secure = new URL(env.webOrigin).protocol === "https:" ? "; Secure" : "";
    c.header(
      "set-cookie",
      `${SIGNUP_INVITE_COOKIE}=${code}; Path=${path}; Max-Age=${SIGNUP_INVITE_COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`,
    );
    c.header("cache-control", "no-store");
    c.header("referrer-policy", "no-referrer");
    return c.redirect(productAppUrl(env.webOrigin, "/sign-in"), 303);
  });
  return app;
}

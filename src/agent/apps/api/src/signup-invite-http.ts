import { productAppUrl } from "@mycellios/contracts";
import {
  SIGNUP_INVITE_COOKIE,
  SIGNUP_INVITE_COOKIE_MAX_AGE_SECONDS,
  signupInviteCodeMatches,
} from "@mycellios/db";
import { Hono } from "hono";
import type { AppEnv } from "./env.js";

type InviteEnv = Pick<AppEnv, "signupInvite" | "authUrl" | "webOrigin">;

/**
 * `GET /api/invite/<code>` is the link an operator shares for a closed beta. It only stores
 * the code in an HttpOnly cookie and opens sign-in; account creation checks the code again
 * and claims one of its places. Unknown codes answer like any missing page.
 */
export function signupInviteHttp(env: InviteEnv): Hono {
  const app = new Hono();
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

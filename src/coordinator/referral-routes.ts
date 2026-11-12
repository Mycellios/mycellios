import type { FastifyInstance, FastifyRequest } from "fastify";
import { Referrals, REFERRAL_TOKEN, type ReferralAccount } from "../economy/referrals.js";

export const REFERRAL_COOKIE = "mycellios_referral_v1";
export function referralReceipt(cookie: string | undefined) {
  const values = (cookie ?? "").split(";").map(part => part.trim()).filter(part => part.startsWith(REFERRAL_COOKIE + "="));
  if (values.length !== 1) return undefined;
  const value = values[0]!.slice(REFERRAL_COOKIE.length + 1);
  return REFERRAL_TOKEN.test(value) ? value : undefined;
}

export function mountReferralRoutes(app: FastifyInstance, options: {
  service: Referrals; publicOrigin: string; account: (request: FastifyRequest) => ReferralAccount | null;
}) {
  const origin = new URL(options.publicOrigin).origin;
  if (new URL(origin).protocol !== "https:") throw new Error("Referral links require an HTTPS public origin");
  app.get<{ Params: { code: string } }>("/v1/referrals/visit/:code", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const receipt = await options.service.visit(request.params.code, referralReceipt(request.headers.cookie));
    reply.header("Cache-Control", "no-store");
    if (receipt) reply.header("Set-Cookie", `${REFERRAL_COOKIE}=${receipt}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`);
    return reply.redirect(new URL("/agent/sign-up", origin).href);
  });
  app.post("/v1/referrals/invite", { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } }, async (request, reply) => {
    const account = options.account(request);
    if (!account) return reply.code(403).send({ error: { code: "account_session_required" } });
    const invite = await options.service.invite(account);
    if (!invite) return reply.code(403).send({ error: { code: "email_verification_required" } });
    reply.header("Cache-Control", "no-store");
    return { ...invite, link: new URL(`/v1/referrals/visit/${invite.code}`, origin).href };
  });
  app.post("/v1/referrals/redeem", { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } }, async (request, reply) => {
    const account = options.account(request);
    if (!account) return reply.code(403).send({ error: { code: "account_session_required" } });
    const header = request.headers["x-mycellios-referral-visit"];
    const receipt = typeof header === "string" && REFERRAL_TOKEN.test(header) ? header : referralReceipt(request.headers.cookie);
    reply.header("Cache-Control", "no-store");
    return options.service.redeem(account, receipt);
  });
}

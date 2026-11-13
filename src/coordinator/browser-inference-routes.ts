import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { browserContributorProofSchema, browserInferenceRequestSchema } from "../contracts/browser-inference.js";
import { BrowserInference } from "./browser-inference.js";
import type { MeshDatabase } from "../storage/database.js";
import type { ContributionCreditWallet } from "../economy/contribution-credit-wallet.js";
import type { ApiAccessManager } from "./api-access.js";
import type { MobileComputeHub } from "./mobile-compute-hub.js";
import type { BrowserInferenceConfig } from "../core/browser-inference-config.js";
import { browserTextChat } from "./browser-text-chat.js";
import type { ManagedEventBudget } from "../economy/managed-event-budget.js";

type Principal = (request: FastifyRequest) => { kind: string; userId?: string; apiKeyId?: string };
export async function initializeBrowserInference(app: FastifyInstance, deps: {
  database: MeshDatabase; wallet: ContributionCreditWallet | null; api: ApiAccessManager;
  hub: MobileComputeHub; config: BrowserInferenceConfig | undefined; apiEnabled: boolean; principal: Principal;
  eventBudget?: ManagedEventBudget | undefined;
}) {
  if (deps.config && (!deps.wallet || !deps.apiEnabled)) throw new Error("browser_inference_requires_account_wallet");
  if (!deps.wallet) return;
  const installed = deps.config || await deps.database.raw.prepare(`SELECT 1 FROM information_schema.tables
    WHERE table_schema=current_schema() AND table_name='economic_browser_inference_credits'`).get();
  if (!installed) return;
  if (deps.config?.offers.some(offer => "kind" in offer)) {
    if (!deps.config.textModelsPath) throw new Error("browser_text_models_path_required");
    await deps.hub.textHub.enable(app, deps.config.textModelsPath);
  }
  const service = new BrowserInference(deps.database, deps.wallet, deps.api, deps.hub,
    deps.config?.offers ?? [], deps.config?.dailyLimitMicrounits ?? 1, deps.eventBudget);
  await service.initialize();
  // Closing new work must not strand reservations or already verified receipts.
  mountBrowserInference(app, service, deps.principal);
  return service;
}

/** Authentication stays in the coordinator's existing account/API-key hook. */
export function mountBrowserInference(app: FastifyInstance, service: BrowserInference,
  principal: Principal) {
  // Public readiness only; no account, worker proof, model secret or balance leaves here.
  app.get("/mobile/v1/contribution-capabilities", async (_request, reply) =>
    reply.header("cache-control", "no-store").send({ schema: "mycellios-browser-contribution/1",
      accountLinking: true, paidInference: service.models().length > 0 }));
  let recovery: ReturnType<typeof setInterval> | undefined;
  let recoveryWork: Promise<void> | undefined;
  app.addHook("onReady", async () => { recovery = setInterval(() => {
    if (recoveryWork) return;
    recoveryWork = service.recoverExpired().catch(() => app.log.warn("Browser lease recovery temporarily unavailable"))
      .finally(() => { recoveryWork = undefined; });
  }, 15_000); recovery.unref(); });
  app.addHook("onClose", async () => { if (recovery) clearInterval(recovery); await recoveryWork; });
  function account(request: FastifyRequest, sessionOnly = false) {
    const identity = principal(request);
    if (!identity.userId || (sessionOnly && identity.kind !== "user")) throw new Error("browser_account_session_required");
    return identity.userId;
  }
  // Suppress tensor/credential/DB diagnostics; only a small public reason allowlist leaves this route.
  const handle = (run: (request: FastifyRequest) => Promise<unknown> | unknown) => async (request: FastifyRequest, reply: import("fastify").FastifyReply) => {
    try { return await run(request); } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const status = code === "browser_account_session_required" || code === "browser_ownership_proof_invalid" ? 403
        : code === "insufficient_contribution_credits" ? 402
        : code === "browser_contributor_unavailable" ? 503 : 409;
      const allowed = new Set(["browser_account_session_required", "browser_ownership_proof_invalid", "insufficient_contribution_credits",
        "browser_contributor_unavailable", "browser_ownership_conflict", "browser_idempotency_conflict", "browser_quote_expired_or_changed",
        "browser_user_budget_exceeded", "browser_funding_required"]);
      return reply.code(status).send({ error: { code: allowed.has(code) ? code : "browser_inference_unavailable" } });
    }
  };
  app.addHook("preHandler", async (request, reply) => {
    const model = (request.body as { model?: unknown } | null)?.model;
    if (request.method === "POST" && request.routeOptions.url === "/v1/chat/completions"
      && typeof model === "string" && model.startsWith("mycellios-browser/"))
      return handle(req => browserTextChat(req, reply, service, account(req), principal(req).apiKeyId ?? null))(request, reply);
  });
  app.get("/v1/browser/models", handle(request => { account(request); return { data: service.models() }; }));
  app.post("/v1/browser/contributors", handle(async request => {
    const owner = account(request, true), proof = browserContributorProofSchema.parse(request.body);
    return await service.bind(owner, proof.workerId, proof.token);
  }));
  app.delete("/v1/browser/contributors/:workerId", handle(request => service.unbind(account(request, true),
    z.object({ workerId: z.string().uuid() }).parse(request.params).workerId)));
  app.post("/v1/browser/inferences/quote", handle(request => service.quote(account(request), request.body)));
  app.post("/v1/browser/inferences", { bodyLimit: 3 * 1024 * 1024 }, handle(request => {
    const owner = account(request), input = z.object({ request: browserInferenceRequestSchema, quote: z.string().max(2048) }).strict().parse(request.body);
    const key = z.string().min(8).max(200).parse(request.headers["idempotency-key"]);
    return service.execute(owner, principal(request).apiKeyId ?? null, key, input.request, input.quote);
  }));
  app.get("/v1/browser/inferences/:key", handle(request => service.status(account(request),
    z.object({ key: z.string().min(8).max(200) }).parse(request.params).key)));
}

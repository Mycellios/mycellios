import type { ChatCompletionRequest } from "../contracts/types.js";
import type { ContributionCreditWallet } from "../economy/contribution-credit-wallet.js";
import type { ApiAccessManager, ApiKeyPrincipal } from "./api-access.js";
import { MeshServiceError } from "./mesh-service.js";

type FundingPrincipal = { kind: "system" } | { kind: "user"; userId: string } | ApiKeyPrincipal;

export async function beginContributionUsage(input: {
  mode: unknown; principal: FundingPrincipal; api: ApiAccessManager;
  wallet: ContributionCreditWallet | null; request: ChatCompletionRequest;
  idempotencyKey: string | undefined; onClose: (release: () => void) => void;
}) {
  const { mode, principal, api, wallet, request, idempotencyKey } = input;
  if (mode !== undefined && mode !== "contribution-credits")
    throw new MeshServiceError("unsupported_funding_mode", "Unsupported funding mode.", 400);
  const funded = mode === "contribution-credits";
  if (funded && (!wallet || principal.kind === "system"))
    throw new MeshServiceError("account_session_required", "Account contribution funding is unavailable.", 403);
  if (funded && wallet && principal.kind !== "system") await wallet.recoverUsage(principal.userId, api);
  const usage = principal.kind === "system" ? null : await api.beginUsage(principal.userId,
    principal.kind === "api_key" ? principal.apiKeyId : null, request, funded);
  if (funded && usage && wallet) {
    try { await wallet.reserve(usage.id, usage.userId, request, idempotencyKey); }
    catch {
      await api.failUsage(usage.id, "contribution_credit_reservation_failed");
      throw new MeshServiceError("insufficient_contribution_credits", "Your available Micos do not cover this request.", 402);
    }
    input.onClose(() => { void wallet.release(usage.id).catch(() => undefined); });
  }
  return { funded, usage };
}

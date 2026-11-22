import { useLingui } from "@lingui/react/macro";
import {
  isStripeRedirect,
  MYCELLIOS_API_USAGE_LIMIT,
  type MycelliosApiPlan,
  type MycelliosApiUsage,
} from "@mycellios/contracts";
import { Badge, Button } from "@mycellios/ui-web";
import { CreditCard, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoadingSkeleton } from "../../components/LoadingSkeleton";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { useSpaceRpc } from "../../lib/space-rpc";

/** The coordinator's Checkout return arrives through the dashboard's `/account` redirect. */
export const API_CHECKOUT_PARAM = "apiCheckout";
const VERIFICATION_ATTEMPTS = 6;
const VERIFICATION_INTERVAL_MS = 2_500;

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function newIdempotencyKey(kind: "subscription" | "portal"): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `mycellios-${kind}-${random}`;
}

function readCheckoutReturn(): "success" | "cancelled" | null {
  const value = new URLSearchParams(window.location.search).get(API_CHECKOUT_PARAM);
  return value === "success" || value === "cancelled" ? value : null;
}

/** Removes the one-time Checkout return marker, keeping every other param and the router state. */
function clearCheckoutReturn() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(API_CHECKOUT_PARAM)) return;
    url.searchParams.delete(API_CHECKOUT_PARAM);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // The marker only changes a notice; leaving it in the address is harmless.
  }
}

function useDescribe() {
  const { t } = useLingui();
  return (error: unknown, action: "load" | "checkout" | "portal"): string => {
    switch (errorCode(error)) {
      case "UNAUTHORIZED": return t`Your Mycellios session expired. Sign in again.`;
      case "PRECONDITION_FAILED": return t`The Mycellios API account is available when you sign in with your Mycellios account.`;
      case "FORBIDDEN": return t`This account cannot manage the Mycellios API subscription.`;
      case "CONFLICT": return t`This account already has a subscription. Manage it from the billing portal.`;
      case "TOO_MANY_REQUESTS": return t`Too many requests. Wait a moment and try again.`;
      default: return action === "load"
        ? t`Could not load this information. Try again.`
        : action === "checkout" ? t`Could not open Stripe Checkout. Try again.` : t`Could not open the billing portal. Try again.`;
    }
  };
}

function SignedOut() {
  const { t } = useLingui();
  return <p role="alert" className="px-1 text-sm text-destructive">{t`The Mycellios API account is available when you sign in with your Mycellios account.`}</p>;
}

export function ApiPlanSettingsPanel({
  accountId,
  navigate = (url) => window.location.assign(url),
}: {
  accountId?: string;
  navigate?: (url: string) => void;
}) {
  const { t, i18n } = useLingui();
  const rpc = useSpaceRpc();
  const describe = useDescribe();
  const [returnState] = useState(readCheckoutReturn);
  useEffect(clearCheckoutReturn, []);
  const [overview, setOverview] = useState<MycelliosApiPlan | null>(null);
  const [busy, setBusy] = useState<"load" | "subscription" | "portal" | null>("load");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [checks, setChecks] = useState(0);
  const subscriptionKey = useRef<string | null>(null);
  const portalKey = useRef<string | null>(null);
  const readSeq = useRef(0);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    const seq = ++readSeq.current;
    setBusy("load"); setLoadError(null);
    try {
      const next = await rpc.mycelliosApiBilling.plan({ expectedUserId: accountId });
      if (live.current && readSeq.current === seq) setOverview(next);
    } catch (error) {
      if (live.current && readSeq.current === seq) setLoadError(describe(error, "load"));
    } finally {
      if (live.current && readSeq.current === seq) setBusy(null);
    }
    // `describe` reads only translated copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, rpc]);

  useEffect(() => { void refresh(); }, [refresh]);

  const state = overview?.subscription?.status ?? "not_subscribed";
  useEffect(() => {
    if (returnState !== "success" || !overview || state === "active" || busy !== null || checks >= VERIFICATION_ATTEMPTS) return;
    const timer = window.setTimeout(() => { setChecks((value) => value + 1); void refresh(); }, VERIFICATION_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [returnState, overview, state, busy, checks, refresh]);

  async function open(kind: "subscription" | "portal") {
    if (!accountId || busy !== null) return;
    setBusy(kind); setActionError(null);
    const keyRef = kind === "subscription" ? subscriptionKey : portalKey;
    // One key per intent, reused after an uncertain failure so no second session opens.
    keyRef.current ??= newIdempotencyKey(kind);
    try {
      const { url } = kind === "subscription"
        ? await rpc.mycelliosApiBilling.checkout({ expectedUserId: accountId, idempotencyKey: keyRef.current })
        : await rpc.mycelliosApiBilling.portal({ expectedUserId: accountId, idempotencyKey: keyRef.current });
      if (!isStripeRedirect(url, kind === "subscription" ? "checkout" : "portal")) throw new Error("unexpected destination");
      keyRef.current = null;
      navigate(url);
    } catch (error) {
      if (live.current) { setActionError(describe(error, kind === "subscription" ? "checkout" : "portal")); setBusy(null); }
    }
  }

  const tokens = (value: number) =>
    new Intl.NumberFormat(i18n.locale, { notation: value >= 100_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
  const money = (micros: number, currency: string) =>
    new Intl.NumberFormat(i18n.locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(micros / 1_000_000);
  const day = (timestamp: number) => new Intl.DateTimeFormat(i18n.locale, { dateStyle: "medium" }).format(new Date(timestamp));

  const intro = (
    <p className="px-1 text-sm text-muted-foreground">
      {t`Mycellios Go is the monthly plan for calling the Mycellios API with your API keys. It is separate from Billing, which covers Mycellios Agent.`}
    </p>
  );
  if (!accountId) return <div className="rk-general-settings space-y-6" data-testid="api-plan-settings">{intro}<SignedOut /></div>;

  const plan = overview?.plan ?? null;
  const planActive = plan?.status === "active";
  const checkoutReady = Boolean(overview?.checkoutAvailable && planActive);
  const verifying = checks < VERIFICATION_ATTEMPTS || busy === "load";
  const status = state === "active"
    ? { label: t`Active`, detail: overview?.subscription ? t`Renews on ${day(overview.subscription.periodEnd)}.` : "" }
    : state === "past_due"
      ? { label: t`Payment due`, detail: t`Update the payment method in the billing portal to keep access.` }
      : state === "cancelled"
        ? { label: t`Cancelled`, detail: checkoutReady ? t`The previous subscription is closed. You can start a new one.` : t`The previous subscription is closed. Checkout is unavailable right now.` }
        : { label: t`Not subscribed`, detail: returnState === "success" ? t`Checkout is being verified. Access stays unchanged until the payment is confirmed.` : checkoutReady ? t`Subscribe securely through Stripe. Access starts after the payment is confirmed.` : t`Subscription checkout is unavailable right now.` };

  return (
    <div className="rk-general-settings space-y-6" data-testid="api-plan-settings">
      {intro}
      {loadError && !overview ? (
        <div role="alert" className="space-y-2 px-1 text-sm text-destructive">
          <p>{loadError}</p>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>{t`Retry`}</Button>
        </div>
      ) : !overview ? (
        <LoadingSkeleton layout="settings" rows={3} label={t`Loading the API subscription…`} />
      ) : (
        <>
          {returnState === "success" && state === "active" ? (
            <p role="status" className="px-1 text-sm">{t`Mycellios Go is active. Your payment is confirmed and the monthly tokens are ready.`}</p>
          ) : returnState === "success" ? (
            <p role="status" className="px-1 text-sm text-muted-foreground">
              {verifying ? t`Checking the checkout status. Access starts after Stripe confirms the payment.` : t`The checkout is still unverified. Refresh later before starting another checkout.`}
            </p>
          ) : returnState === "cancelled" && state !== "active" ? (
            <p role="status" className="px-1 text-sm text-muted-foreground">{t`Checkout closed. Your current status is shown below.`}</p>
          ) : null}
          <SettingsGroup>
            <SettingsRow
              label={<span className="inline-flex flex-wrap items-center gap-2">Mycellios Go<Badge variant={state === "active" ? "default" : "secondary"}>{status.label}</Badge></span>}
              description={<>
                <span className="block">{planActive && plan ? t`${money(plan.amountMicros, plan.currency)} per month` : t`Price unavailable`}</span>
                {status.detail ? <span className="block">{status.detail}</span> : null}
              </>}
              control={(
                <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => void refresh()} aria-label={t`Refresh the API subscription`}>
                  <RefreshCw aria-hidden size={14} />
                </Button>
              )}
            />
            <SettingsRow label={t`Included each month`} description={planActive && plan ? t`${tokens(plan.includedTokens)} tokens` : t`No active plan`} />
            <SettingsRow label={t`API token balance`} description={overview.tokenBalance === null ? t`Unavailable` : t`${tokens(overview.tokenBalance)} tokens`} />
            {overview.tokenDebt > 0 ? (
              <SettingsRow label={t`Token debt`} description={t`${tokens(overview.tokenDebt)} tokens. Future grants repay reversed usage before increasing the balance.`} />
            ) : null}
          </SettingsGroup>
          <div className="flex flex-wrap items-center gap-2 px-1">
            {state === "not_subscribed" || state === "cancelled" ? (
              <Button type="button" size="sm" disabled={!checkoutReady || busy !== null} onClick={() => void open("subscription")}>
                <CreditCard aria-hidden size={14} />
                {busy === "subscription" ? t`Opening Stripe…` : checkoutReady ? t`Subscribe with Stripe` : !planActive ? t`Plan unavailable` : t`Checkout unavailable`}
              </Button>
            ) : null}
            {overview.portalAvailable && state !== "cancelled" ? (
              <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void open("portal")}>
                <CreditCard aria-hidden size={14} />{busy === "portal" ? t`Opening the portal…` : t`Manage the API subscription`}
              </Button>
            ) : null}
          </div>
          {loadError ? <p role="alert" className="px-1 text-sm text-destructive">{loadError}</p> : null}
          {actionError ? <p role="alert" className="px-1 text-sm text-destructive">{actionError}</p> : null}
        </>
      )}
    </div>
  );
}

export function ApiUsageSettingsPanel({ accountId }: { accountId?: string }) {
  const { t, i18n } = useLingui();
  const rpc = useSpaceRpc();
  const describe = useDescribe();
  const [usage, setUsage] = useState<MycelliosApiUsage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setUsage(null); setLoadError(null);
    if (!accountId) return;
    const abort = new AbortController();
    void rpc.mycelliosApiBilling.usage({ expectedUserId: accountId }, { signal: abort.signal })
      .then((result) => { if (!abort.signal.aborted) setUsage(result); })
      .catch((error: unknown) => { if (!abort.signal.aborted) setLoadError(describe(error, "load")); });
    return () => abort.abort();
    // `describe` reads only translated copy; the read follows account and retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, rpc, attempt]);

  const count = (value: number) =>
    new Intl.NumberFormat(i18n.locale, { notation: value >= 100_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
  const byModel = new Map<string, { requests: number; tokens: number }>();
  for (const entry of usage?.requests ?? []) {
    const current = byModel.get(entry.model) ?? { requests: 0, tokens: 0 };
    byModel.set(entry.model, { requests: current.requests + 1, tokens: current.tokens + entry.totalTokens });
  }
  const models = [...byModel.entries()].sort((left, right) => right[1].tokens - left[1].tokens);
  const limit = MYCELLIOS_API_USAGE_LIMIT;

  return (
    <div className="rk-general-settings space-y-6" data-testid="api-usage-settings">
      <p className="px-1 text-sm text-muted-foreground">
        {t`Requests made with your API keys from your own apps and scripts. What your Micos use appears in Profile.`}
      </p>
      {!accountId ? <SignedOut /> : loadError ? (
        <div role="alert" className="space-y-2 px-1 text-sm text-destructive">
          <p>{loadError}</p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>{t`Retry`}</Button>
        </div>
      ) : !usage ? (
        <LoadingSkeleton layout="settings" rows={3} label={t`Loading API usage…`} />
      ) : (
        <>
          <SettingsGroup title={t`Total`}>
            <SettingsRow label={t`Requests`} description={usage.totals ? count(usage.totals.requestCount) : t`Unavailable`} />
            <SettingsRow label={t`Input tokens`} description={usage.totals ? count(usage.totals.inputTokens) : t`Unavailable`} />
            <SettingsRow label={t`Output tokens`} description={usage.totals ? count(usage.totals.outputTokens) : t`Unavailable`} />
          </SettingsGroup>
          {models.length === 0 ? (
            <p className="px-1 text-sm text-muted-foreground">{t`No requests with your API keys yet.`}</p>
          ) : (
            <SettingsGroup title={t`Last ${limit} requests by model`}>
              {models.map(([model, total]) => (
                <SettingsRow
                  key={model}
                  label={<span className="break-all">{model}</span>}
                  description={`${t`Requests`}: ${count(total.requests)} · ${t`Tokens`}: ${count(total.tokens)}`}
                />
              ))}
            </SettingsGroup>
          )}
        </>
      )}
    </div>
  );
}

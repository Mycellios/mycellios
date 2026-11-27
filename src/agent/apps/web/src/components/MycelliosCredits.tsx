import { useLingui } from "@lingui/react/macro";
import { CREDIT_MICROUNITS } from "@mycellios/contracts";
import type { MycelliosAccount } from "@mycellios/contracts";
import { Coins, Gift, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { rpc } from "../lib/rpc";

type BalanceState = {
  ownerId: string;
  account: MycelliosAccount | null;
  loading: boolean;
  unavailable: boolean;
  accessDenied: boolean;
};

const initialState = (ownerId: string): BalanceState => ({
  ownerId, account: null, loading: Boolean(ownerId), unavailable: false, accessDenied: false,
});

function accessFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const failure = error as { code?: unknown; status?: unknown };
  return failure.code === "UNAUTHORIZED" || failure.code === "FORBIDDEN" ||
    failure.status === 401 || failure.status === 403;
}

export function MycelliosCredits({ ownerId, onConnect }: { ownerId: string; onConnect?: () => void }) {
  const { t, i18n } = useLingui();
  const refreshBalance = useRef<() => void>(() => undefined);
  const [state, setState] = useState<BalanceState>(() => initialState(ownerId));
  const [gain, setGain] = useState<{ownerId:string; amount:number} | null>(null);
  const priorEarnings = useRef<{ownerId:string; amount:number} | null>(null);
  useEffect(() => { const earned = state.ownerId === ownerId ? state.account?.contributionEarnedMicrounits : undefined;
    if (earned === undefined) { priorEarnings.current = null; setGain(null); return; }
    setGain(null);
    const previous = priorEarnings.current;
    priorEarnings.current = {ownerId,amount:earned};
    if (!previous || previous.ownerId !== ownerId || earned <= previous.amount) return;
    setGain({ownerId,amount:earned-previous.amount}); const timer = window.setTimeout(()=>setGain(null),5000);
    return ()=>window.clearTimeout(timer);
  }, [state.account?.contributionEarnedMicrounits, state.ownerId, ownerId]);
  // Never display one account's last verified balance during an identity change.
  const current = state.ownerId === ownerId ? state : initialState(ownerId);
  const { account, loading, unavailable, accessDenied } = current;
  useEffect(() => {
    setState(initialState(ownerId));
    if (!ownerId) return;
    let active = true;
    let pending = false;
    let queued = false;
    let queuedFresh = false;
    let failures = 0;
    let contributing = document.body.dataset.mycelliosContributing === "true";
    let timer: number | undefined;
    let deadline: number | undefined;
    let verifiedRefresh: number | undefined;
    let request: AbortController | undefined;
    const schedule = (delay: number, fresh = false) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void refresh(fresh); }, delay);
    };
    // Polling and focus may share the server's short per-owner read; known balance changes bypass it.
    const refresh = async (fresh = false) => {
      if (!active) return;
      if (pending) { queued = true; queuedFresh ||= fresh; return; }
      window.clearTimeout(timer);
      pending = true;
      request = new AbortController();
      deadline = window.setTimeout(() => request?.abort(), 12_000);
      let delay = contributing ? 5_000 : 60_000;
      try {
        const value = await rpc.models.mycelliosAccount(fresh ? { refresh: true } : undefined, { signal: request.signal });
        if (active) {
          failures = 0;
          setState({ ownerId, account: value, loading: false, unavailable: false, accessDenied: false });
        }
      } catch (error) {
        if (active) {
          const denied = accessFailure(error);
          delay = denied ? 60_000 : ([2_000, 5_000, 15_000, 60_000][Math.min(failures++, 3)] ?? 60_000);
          if (denied) { queued = false; queuedFresh = false; }
          setState(previous => ({
            ownerId,
            account: denied || previous.ownerId !== ownerId ? null : previous.account,
            loading: false, unavailable: true, accessDenied: denied,
          }));
        }
      } finally {
        window.clearTimeout(deadline);
        deadline = undefined;
        request = undefined;
        pending = false;
        if (active) {
          schedule(queued ? 0 : delay, queued && queuedFresh);
          queued = false;
          queuedFresh = false;
        }
      }
    };
    refreshBalance.current = () => { void refresh(); };
    void refresh();
    const onFocus = () => {
      void refresh();
    };
    const onActivity = () => { contributing = document.body.dataset.mycelliosContributing === "true"; schedule(contributing ? 0 : 60_000); };
    const onVerified = () => {
      // Bound bursts to one read per second; late settlement is caught by polling.
      if (verifiedRefresh !== undefined) return;
      verifiedRefresh = window.setTimeout(() => { verifiedRefresh = undefined; void refresh(true); }, 1000);
    };
    window.addEventListener("mycellios:contribution-verified", onVerified);
    window.addEventListener("mycellios:wallet-changed", onVerified);
    window.addEventListener("mycellios:contribution-activity", onActivity);
    window.addEventListener("focus", onFocus);
    window.addEventListener("mycellios:contribution-changed", onFocus);
    return () => {
      active = false;
      refreshBalance.current = () => undefined;
      request?.abort();
      window.clearTimeout(timer);
      window.clearTimeout(deadline);
      window.clearTimeout(verifiedRefresh);
      window.removeEventListener("mycellios:contribution-verified", onVerified);
      window.removeEventListener("mycellios:wallet-changed", onVerified);
      window.removeEventListener("mycellios:contribution-activity", onActivity);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("mycellios:contribution-changed", onFocus);
    };
  }, [ownerId]);
  const balance = account?.availableMicrounits ?? account?.balanceMicrounits;
  const hasPromotion = (account?.promotionalGrantedMicrounits ?? 0) > 0;
  const statusLabel = loading ? "…" : balance == null ? t`Balance unavailable`
    : new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 6 }).format(balance / CREDIT_MICROUNITS);
  // The exact balance stays (contribution earns millionths), but only its first two decimals stand
  // out: "1,13" reads at a glance and the rest follows smaller.
  const amount = balance == null || loading ? null : (() => {
    const parts = new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 6 }).formatToParts(balance / CREDIT_MICROUNITS);
    let lead = "", tail = "", seenDecimal = false, fraction = 0;
    for (const part of parts) {
      if (part.type === "decimal") { seenDecimal = true; lead += part.value; continue; }
      if (seenDecimal && part.type === "fraction") {
        lead += part.value.slice(0, 2); tail += part.value.slice(2); fraction += part.value.length; continue;
      }
      if (tail) tail += part.value; else lead += part.value;
    }
    return { lead, tail, fraction };
  })();
  return (
    <div
      data-testid="mycellios-micos"
      className="flex w-full min-w-0 items-center gap-2 text-xs text-muted-foreground"
      aria-live="polite"
      aria-busy={loading}
      data-balance-status={loading ? "loading" : unavailable ? (account ? "stale" : "unavailable") : account ? "ready" : "unavailable"}
      title={accessDenied ? t`Sign in again to see your credits.` : unavailable ? (account ? t`Last verified balance. Retrying automatically.` : t`Balance temporarily unavailable. Retrying automatically.`) : (!loading && !account) ? t`Credits are not enabled in this installation.` : t`Credits are your internal Mycellios balance. Adding 10 USD gives you 10 credits. Spore is a separate token.`}
    >
      <div className="flex min-h-7 min-w-0 flex-1 items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Coins aria-hidden className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="truncate">{account?.environment === "sandbox" ? t`Test credits` : t`Credits`}</span>
        </span>
        {!loading && !unavailable && !account ? <button type="button" className="text-xs text-foreground hover:underline" onClick={onConnect} disabled={!onConnect} title={t`Credits are not enabled in this installation.`}>{t`Not enabled`}</button>
          : amount ? <span className="min-w-0 truncate tabular-nums text-foreground" title={statusLabel}>
            <span className="text-sm font-semibold">{amount.lead}</span>{amount.tail ? <span className="text-[10px] text-muted-foreground">{amount.tail}</span> : null}
          </span>
          : <span className="min-w-0 truncate tabular-nums text-muted-foreground">{statusLabel}</span>}
      </div>
      {gain?.ownerId === ownerId && !unavailable && <span role="status" className="rk-credit-gain">+{new Intl.NumberFormat(i18n.locale,{maximumFractionDigits:6}).format(gain.amount/CREDIT_MICROUNITS)} {t`Earned`}</span>}
      {hasPromotion ? <span className="grid size-5 shrink-0 place-items-center text-muted-foreground" title={t`Promotional grant, separate from earned credits`}>
        <Gift aria-hidden className="size-3.5" /><span className="sr-only">{t`Promo`}</span>
      </span> : null}
      {unavailable && !accessDenied ? <button type="button" aria-label={t`Retry`} title={t`Retry`}
        className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => refreshBalance.current()}><RefreshCw className="size-3.5" aria-hidden /></button> : null}
    </div>
  );
}

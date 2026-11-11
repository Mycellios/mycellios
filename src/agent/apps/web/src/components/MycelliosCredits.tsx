import { useLingui } from "@lingui/react/macro";
import { CREDIT_MICROUNITS, productBrand } from "@rakazo/contracts";
import type { MycelliosAccount } from "@rakazo/contracts";
import { RefreshCw } from "lucide-react";
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

export function MycelliosCredits({ ownerId }: { ownerId: string }) {
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
    let failures = 0;
    let contributing = document.body.dataset.mycelliosContributing === "true";
    let timer: number | undefined;
    let deadline: number | undefined;
    let request: AbortController | undefined;
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void refresh(); }, delay);
    };
    const refresh = async () => {
      if (!active) return;
      if (pending) { queued = true; return; }
      window.clearTimeout(timer);
      pending = true;
      request = new AbortController();
      deadline = window.setTimeout(() => request?.abort(), 12_000);
      let delay = contributing ? 5_000 : 60_000;
      try {
        const value = await rpc.models.mycelliosAccount(undefined, { signal: request.signal });
        if (active) {
          failures = 0;
          setState({ ownerId, account: value, loading: false, unavailable: false, accessDenied: false });
        }
      } catch (error) {
        if (active) {
          const denied = accessFailure(error);
          delay = denied ? 60_000 : ([2_000, 5_000, 15_000, 60_000][Math.min(failures++, 3)] ?? 60_000);
          if (denied) queued = false;
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
          schedule(queued ? 0 : delay);
          queued = false;
        }
      }
    };
    refreshBalance.current = () => { void refresh(); };
    void refresh();
    const onFocus = () => {
      void refresh();
    };
    const onActivity = () => { contributing = document.body.dataset.mycelliosContributing === "true"; schedule(contributing ? 0 : 60_000); };
    window.addEventListener("mycellios:contribution-activity", onActivity);
    window.addEventListener("focus", onFocus);
    window.addEventListener("mycellios:contribution-changed", onFocus);
    window.addEventListener("mycellios:credits-changed", onFocus);
    return () => {
      active = false;
      refreshBalance.current = () => undefined;
      request?.abort();
      window.clearTimeout(timer);
      window.clearTimeout(deadline);
      window.removeEventListener("mycellios:contribution-activity", onActivity);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("mycellios:contribution-changed", onFocus);
      window.removeEventListener("mycellios:credits-changed", onFocus);
    };
  }, [ownerId]);
  const balance = account?.availableMicrounits ?? account?.balanceMicrounits;
  const hasPromotion = (account?.promotionalGrantedMicrounits ?? 0) > 0;
  const statusLabel = loading ? "…" : balance == null ? t`Balance unavailable`
    : new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 6 }).format(balance / CREDIT_MICROUNITS);
  return (
    <div
      data-testid="mycellios-micos"
      className="flex w-full min-w-0 items-center gap-2 text-xs text-muted-foreground"
      aria-live="polite"
      aria-busy={loading}
      data-balance-status={loading ? "loading" : unavailable ? (account ? "stale" : "unavailable") : account ? "ready" : "unavailable"}
      title={accessDenied ? t`Sign in again to see your credits.` : unavailable ? (account ? t`Last verified balance. Retrying automatically.` : t`Balance temporarily unavailable. Retrying automatically.`) : (!loading && !account) ? t`Balance unavailable` : t`Credits are your internal Mycellios balance. Adding 10 USD gives you 10 credits. Spore is a separate token.`}
    >
      <a className="flex min-h-8 min-w-0 flex-1 items-center justify-between gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-ring hover:text-foreground"
        href={new URL("/dashboard", productBrand.apiBaseUrl).href} target="_blank" rel="noopener noreferrer" aria-label={t`View credits`}>
        <span>{account?.environment === "sandbox" ? t`Test credits` : t`Credits`}</span>
        <span className={`min-w-0 truncate tabular-nums ${balance == null ? "text-muted-foreground" : "font-medium text-foreground"}`}>{statusLabel}</span>
      </a>
      {gain?.ownerId === ownerId && !unavailable && <span role="status" className="rk-credit-gain">+{new Intl.NumberFormat(i18n.locale,{maximumFractionDigits:6}).format(gain.amount/CREDIT_MICROUNITS)} {t`Earned`}</span>}
      {hasPromotion ? <span className="text-[10px] text-muted-foreground" title={t`Promotional grant, separate from earned credits`}>{t`Promo`}</span> : null}
      {unavailable && !accessDenied ? <button type="button" aria-label={t`Retry`} title={t`Retry`}
        className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => refreshBalance.current()}><RefreshCw className="size-3.5" aria-hidden /></button> : null}
    </div>
  );
}

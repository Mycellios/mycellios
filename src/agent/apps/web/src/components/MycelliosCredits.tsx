import { useLingui } from "@lingui/react/macro";
import { CREDIT_MICROUNITS } from "@rakazo/contracts";
import type { MycelliosAccount } from "@rakazo/contracts";
import { useEffect, useState } from "react";
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
  const [state, setState] = useState<BalanceState>(() => initialState(ownerId));
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
      let delay = 60_000;
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
    void refresh();
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("mycellios:contribution-changed", onFocus);
    return () => {
      active = false;
      request?.abort();
      window.clearTimeout(timer);
      window.clearTimeout(deadline);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("mycellios:contribution-changed", onFocus);
    };
  }, [ownerId]);
  const balance = account?.availableMicrounits ?? account?.balanceMicrounits;
  const hasPromotion = (account?.promotionalGrantedMicrounits ?? 0) > 0;
  return (
    <div
      data-testid="mycellios-micos"
      className="flex min-w-0 shrink-0 items-center justify-between gap-3 px-5 py-2 text-xs text-muted-foreground"
      aria-live="polite"
      aria-busy={loading}
      data-balance-status={loading ? "loading" : unavailable ? (account ? "stale" : "unavailable") : account ? "ready" : "unavailable"}
      title={accessDenied ? t`Sign in again to see your credits.` : unavailable ? (account ? t`Last verified balance. Retrying automatically.` : t`Balance temporarily unavailable. Retrying automatically.`) : (!loading && !account) ? t`Unavailable` : t`Credits are your internal Mycellios balance. Adding 10 USD gives you 10 credits. Spore is a separate token.`}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        {account?.environment === "sandbox" ? t`Test credits` : t`Credits`}
      </span>
      <span className="flex min-w-0 flex-col items-end gap-0.5 text-right">
        <span className="min-w-0 break-all font-medium tabular-nums text-foreground">
          {loading ? "…" : balance == null ? "—" : new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 6 }).format(balance / CREDIT_MICROUNITS)}
        </span>
        {unavailable && !accessDenied && <span className="text-[10px] leading-tight text-muted-foreground">{account ? t`Refreshing…` : t`Retrying…`}</span>}
        {hasPromotion && <span className="text-[10px] leading-tight text-success" title={t`Promotional grant, separate from earned credits`}>Promo</span>}
      </span>
    </div>
  );
}

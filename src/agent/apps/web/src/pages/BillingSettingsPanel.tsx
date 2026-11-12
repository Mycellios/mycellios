import { Plural, useLingui } from "@lingui/react/macro";
import type { BillingStatus } from "@rakazo/contracts";
import { Button, Skeleton } from "@rakazo/ui-web";
import { useEffect, useRef, useState } from "react";
import { ModelCreditsSettings } from "../components/ModelCredits";
import { formatBillingDate, formatBillingPrice } from "../lib/billing";
import { rpc } from "../lib/rpc";
import { CreditCard, ShieldCheck } from "lucide-react";
import { SettingsGroup, SettingsRow } from "../components/SettingsRows";
import { BillingServers } from "./settings/BillingServers";

export function BillingSettingsPanel({ enabled = true }: { enabled?: boolean }) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lock = useRef(false);

  useEffect(() => {
    let active = true;
    setError(null); setStatus(null);
    if (!enabled) return;
    rpc.billing
      .status()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(() => {
        if (active) setError(t`Could not load billing`);
      });
    return () => {
      active = false;
    };
  }, [t, attempt, enabled]);

  async function openPortal() {
    if (lock.current || !enabled || !status?.canManage || !status.hasCustomer) return;
    lock.current = true; setPending(true);
    setError(null);
    try {
      const { url } = await rpc.billing.portal();
      window.location.assign(url);
    } catch {
      setError(t`Could not open billing`);
    } finally {
      // Desktop opens the URL in the system browser and this page stays, so re-enable.
      lock.current = false; setPending(false);
    }
  }

  const stateLabel = status
    ? status.state === "trialing"
      ? t`Trial`
      : status.state === "active"
        ? t`Active`
        : status.state === "past_due"
          ? t`Past due`
          : status.state === "canceled" ? t`Canceled`
          : status.state === "paused" ? t`Paused`
          : status.state === "unpaid" ? t`Unpaid`
          : status.state === "incomplete" ? t`Incomplete`
          : t`Inactive`
    : null;

  const date = status ? billingDate(status) : null;
  const day = date ? formatBillingDate(date.at, locale) : "";
  const dateLabel = date
    ? date.kind === "trial"
      ? t`Trial ends ${day}`
      : date.kind === "ends"
        ? t`Ends ${day}`
        : t`Renews ${day}`
    : null;

  const price = status?.price ? formatBillingPrice(status.price, locale) : null;
  const seats = status?.seats ?? 0;

  return <div data-testid="billing-settings" className="rk-general-settings space-y-8">
    <section data-slot="settings-section" className="space-y-3">
      <div className="px-1"><h3 className="text-sm font-medium">{t`Your plan`}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t`Your account, model credits and server connections in one place.`}</p></div>
      {!enabled ? <SettingsGroup><SettingsRow label={<span className="inline-flex items-center gap-3"><ShieldCheck aria-hidden size={17} />{t`Mycellios account`}</span>}
        description={t`Payments are not enabled on this server. No subscription or charge is started here.`} control={<span className="text-xs text-muted-foreground">{t`Not configured`}</span>} /></SettingsGroup>
      : !status ? <div className="rounded-xl border border-border p-4">{error ? <div role="alert" className="text-sm text-destructive"><p>{error}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => setAttempt(value => value + 1)}>{t`Retry`}</Button></div> : <div role="status" aria-label={t`Loading billing`}><Skeleton className="h-5 w-36" /></div>}</div>
      : <>
        <SettingsGroup><SettingsRow label={<span className="inline-flex flex-wrap items-center gap-3"><ShieldCheck aria-hidden size={17} />{t`Mycellios account`}<span className="rounded-full border border-border px-2 py-0.5 text-xs font-normal text-muted-foreground">{t`Current`}</span></span>}
          description={status.funding !== undefined ? status.funding === "byok" ? t`Using your own model subscription or API key.` : status.funding === "credits" ? t`Models are paid with your Mycellios Credits.` : t`Choose how to connect your models below.` : t`Subscription for this account. Server connections are managed separately.`}
          control={<span className="text-sm text-muted-foreground">{status.funding !== undefined ? status.funding === "byok" ? t`Your own provider` : t`Credits` : stateLabel}</span>} />
          {status.funding === undefined && <SettingsRow label={<span className="inline-flex items-center gap-3"><CreditCard aria-hidden size={17} />{t`Subscription`}</span>}
            description={<span>{price}{seats > 1 && <span className="ml-2"><Plural value={seats} one="# seat" other="# seats" /></span>}{dateLabel && <span className="mt-1 block">{dateLabel}</span>}{!price && !dateLabel && t`No recurring price reported for this account.`}</span>}
            control={status.canManage && status.hasCustomer ? <Button variant="outline" size="sm" disabled={pending} onClick={() => void openPortal()}>{t`Manage`}</Button> : undefined} />}
        </SettingsGroup>
        {status.funding !== undefined && <ModelCreditsSettings status={status} refresh={async () => setStatus(await rpc.billing.status())} />}
        {!status.canManage && <p className="px-1 text-sm text-muted-foreground">{t`Only the account owner can change billing.`}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </>}
    </section>
    <BillingServers />
  </div>;
}

function billingDate(
  status: BillingStatus,
): { kind: "trial" | "ends" | "renews"; at: string } | null {
  if (status.state === "trialing" && status.trialEndsAt) {
    return { kind: "trial", at: status.trialEndsAt };
  }
  // Unpaid and paused subscriptions do not renew until the owner resumes them.
  if (!status.currentPeriodEndsAt || status.state === "unpaid" || status.state === "paused" || status.state === "incomplete") {
    return null;
  }
  if (status.cancelAtPeriodEnd || status.state === "canceled") {
    return { kind: "ends", at: status.currentPeriodEndsAt };
  }
  return { kind: "renews", at: status.currentPeriodEndsAt };
}

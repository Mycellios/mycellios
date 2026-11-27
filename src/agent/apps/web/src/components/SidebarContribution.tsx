import { startContributionGrowth, stopContributionGrowth } from "../lib/contribution-growth";
import "./contribution.css";
import { ContributionSpinner } from "./ContributionSpinner";
import { useLingui } from "@lingui/react/macro";
import { Button } from "@mycellios/ui-web";
import { Pause, Play, RefreshCw, Sprout } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fetchAuthCapabilities } from "../lib/auth-capabilities";
import { desktopBridge } from "../lib/desktop";
import { rpc } from "../lib/rpc";
import { BrowserContributionControl } from "./BrowserContributionControl";
import { setContributionActivity } from "../lib/contribution-activity";

/** Desktop's refusal for a page that is not the official Mycellios app (apps/desktop main.ts). */
function isOfficialPageRefusal(cause: unknown) {
  return cause instanceof Error && cause.message.includes("Contribution requires the Mycellios application");
}


type Status = Awaited<ReturnType<typeof rpc.models.contributionStatus>>;

/** Shared sidebar; starting compute is an explicit user action, never an effect. */
export function SidebarContribution({ mini = false, activationLabel, expanded = false }: { mini?: boolean; activationLabel?: string; expanded?: boolean }) {
  const { t } = useLingui();
  const desktop = desktopBridge();
  const runtime = desktop?.runtime;
  const [node, setNode] = useState<Status | null>(null);
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [needsIdentity, setNeedsIdentity] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const [accountUnavailable, setAccountUnavailable] = useState(false);
  const [upgradeAvailable, setUpgradeAvailable] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeFailed, setUpgradeFailed] = useState(false);
  const [supported, setSupported] = useState(Boolean(runtime));
  const mounted = useRef(true);
  const reading = useRef(false);
  const operating = useRef(false);
  const revision = useRef(0);
  const indicator = useRef(Symbol("contribution"));
  async function refresh() {
    if (!runtime || reading.current || operating.current) return;
    const epoch = revision.current;
    reading.current = true;
    try {
      // A local/password-only server cannot authorize the cloud contributor.
      // The Desktop runtime belongs to its linked account, not this Dev login.
      const capabilities = await fetchAuthCapabilities();
      if (!capabilities.sso) {
        if (mounted.current && epoch === revision.current) { setAccountUnavailable(true); setNode(null); setError(false); }
        return;
      }
      let local: Awaited<ReturnType<typeof runtime.status>>;
      try { local = await runtime.status(); }
      catch (cause) {
        // Desktop runs the contributor only for the official Mycellios page; another server
        // (self-hosted or a local preview) is refused every time, so offer the browser path.
        if (!isOfficialPageRefusal(cause)) throw cause;
        if (mounted.current && epoch === revision.current) { setAccountUnavailable(true); setNode(null); setError(false); }
        return;
      }
      if (mounted.current && epoch === revision.current) setAccountUnavailable(false);
      const missingRuntime = local.enrolled && !local.installed;
      if (mounted.current && epoch === revision.current) {
        setSupported(local.supported);
        setNeedsIdentity(local.installed && local.enrolled && !local.nodeId);
        setIncomplete(missingRuntime);
        setUpgradeAvailable(Boolean(local.upgradeAvailable && runtime.upgrade));
      }
      const value = !missingRuntime && local.nodeId ? await rpc.models.contributionStatus({ nodeId: local.nodeId }) : null;
      if (mounted.current && epoch === revision.current) { setNode(value); setError(false); }
    } catch { if (mounted.current && epoch === revision.current) setError(true); }
    finally { reading.current = false; }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 10_000);
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => { mounted.current = false; window.clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [runtime]);
  async function toggle() {
    if (busy || operating.current || accountUnavailable) return;
    if (!runtime || !supported) return;
    const action = node?.enabled === true ? "pause" : "resume";
    revision.current++; operating.current = true;
    setRequested(true); setBusy(true); setError(false);
    try {
      if (!(await fetchAuthCapabilities()).sso) {
        if (mounted.current) { setAccountUnavailable(true); setNode(null); }
        return;
      }
      let local = await runtime.status();
      // A verification click stays read-only even if another process has already
      // published the identity. Starting compute always needs a separate click.
      const verifyingOnly = needsIdentity || (local.enrolled && !local.nodeId);
      if (local.enrolled && !local.installed) {
        if (mounted.current) { setIncomplete(true); setNode(null); }
        return;
      }
      if (needsIdentity && !local.enrolled) throw new Error("The existing runtime identity is unavailable");
      if (!local.enrolled) local = await runtime.enroll(await rpc.models.contributionEnrollment());
      else if (!local.nodeId && runtime.identify) local = await runtime.identify();
      if (!local.nodeId) throw new Error("Identity unavailable");
      if (mounted.current) setNeedsIdentity(false);
      // Never toggle stale state or replay a command whose result is uncertain.
      const current = await rpc.models.contributionStatus({ nodeId: local.nodeId });
      if (verifyingOnly || current.pending || current.enabled === (action === "resume")) {
        if (mounted.current) setNode(current);
        window.dispatchEvent(new Event("mycellios:contribution-changed"));
        return;
      }
      const next = await rpc.models.contributionControl({ nodeId: local.nodeId, action });
      if (mounted.current) setNode(next);
      window.dispatchEvent(new Event("mycellios:contribution-changed"));
    } catch { if (mounted.current) setError(true); }
    finally { operating.current = false; if (mounted.current) setBusy(false); }
  }
  /** One-time, explicit lift of an older runtime to signed automatic updates. */
  async function upgradeRuntime() {
    if (!runtime?.upgrade || upgrading || operating.current) return;
    revision.current++; operating.current = true;
    setUpgrading(true); setUpgradeFailed(false);
    try {
      const local = await runtime.upgrade();
      if (mounted.current) setUpgradeAvailable(Boolean(local.upgradeAvailable));
    } catch { if (mounted.current) setUpgradeFailed(true); }
    finally { operating.current = false; if (mounted.current) setUpgrading(false); }
  }
  const waiting = Boolean(node?.pending);
  const active = node?.enabled === true;
  const hasError = !incomplete && (error || Boolean(node?.rejected));
  // Stopping must always stay possible: after a rejected command or a failed read,
  // a click on a running contributor sends a pause (toggle re-reads the current
  // state first). Starting again after an error still only refreshes.
  const retryPause = hasError && active;
  const confirmedActive = Boolean(runtime) && supported && active && node?.connected === true && !hasError && !incomplete && !accountUnavailable && !needsIdentity;
  useEffect(() => {
    const key = indicator.current;
    setContributionActivity(key, !expanded && confirmedActive);
    return () => { setContributionActivity(key, false); };
  }, [confirmedActive, expanded]);
  const idleLabel = activationLabel ?? t`Earn credits`;
  const shortLabel = t`Earn with your computer`;
  const unavailable = !runtime || !supported || incomplete || accountUnavailable;
  const label = busy ? needsIdentity ? t`Verifying this computer…` : t`Setting up contribution…`
    : needsIdentity ? t`Verify this computer` : hasError && !retryPause ? t`Retry`
    : waiting ? t`Waiting for this computer…` : active ? t`Pause contribution` : idleLabel;
  const detail = accountUnavailable ? t`Contribute in your browser while this page stays open.`
    : incomplete ? t`The local contribution runtime is missing.`
    : needsIdentity ? error ? t`Could not verify this computer. Try again or open the dashboard.` : t`Verify the existing installation before contributing.`
    : hasError ? t`Could not confirm contribution. Try again or open the dashboard.`
    : !runtime || !supported ? t`Use this browser to contribute while the page stays open.`
    : node && !node.connected ? t`Computer offline. Waiting for reconnection.`
    : active ? t`Credits are added after the network verifies your work.`
    : t`Share this computer’s resources and earn credits for verified work.`;
  const spinning = busy || (waiting && !hasError);
  const actionClass = `${!expanded ? "rk-contribution-button " : ""}h-auto min-h-9 min-w-0 justify-start gap-1.5 px-2 py-1 text-start text-xs font-medium`;
  const controls = <div data-testid="contribution-control" data-active={confirmedActive ? "true" : "false"} className={mini ? "shrink-0 px-2 py-1" : "rk-contribution-control min-w-0 max-w-full"}>
    <div className="flex min-w-0 items-center">
    <Button variant="ghost" className={actionClass}
      onClick={event => { if (active) stopContributionGrowth(); else if (!hasError && !needsIdentity) startContributionGrowth(event.currentTarget); if (hasError && !needsIdentity && !retryPause) void refresh(); else void toggle(); }} disabled={unavailable || busy || (waiting && !hasError)} aria-label={label} title={unavailable ? t`Available on Desktop` : mini ? `${label}. ${detail}` : detail}>
      {!mini && <Sprout aria-hidden className={`size-4 shrink-0 text-emerald-600 dark:text-emerald-400 ${confirmedActive ? "rk-contribution-sprout" : ""}`} />}
      {!mini && <span className="min-w-0 flex-1 text-start"><span className="block text-sm">{expanded ? (label === idleLabel ? shortLabel : label) : busy || waiting ? (node?.pending === "pause" ? t`Pausing…` : t`Activating…`) : t`Earn credits`}</span><span className="block text-[11px] text-muted-foreground">{hasError && !retryPause ? t`Retry` : needsIdentity ? t`Verify this computer` : active ? t`Pause` : t`Share computing power with the network`}</span></span>}
      <span className={mini ? "rk-contribution-play rk-contribution-play-mini" : "rk-contribution-play"}>{spinning ? <ContributionSpinner /> : (hasError && !retryPause) || needsIdentity ? <RefreshCw size={22} className="size-5" aria-hidden /> : active ? <Pause size={22} className="size-5" fill="currentColor" strokeWidth={0} aria-hidden /> : <Play size={22} className="size-5 ms-0.5" aria-hidden />}</span>
    </Button>
    </div>
    {!mini && unavailable && <p className="px-2 text-[11px] text-muted-foreground">{t`Available on Desktop`}</p>}
    {!mini && !unavailable && upgradeAvailable && (
      <div className="px-2 pb-1">
        <Button variant="outline" size="sm" className="h-auto min-h-8 w-full justify-start gap-1.5 px-2 py-1 text-start text-xs" onClick={() => { void upgradeRuntime(); }} disabled={upgrading || busy}>
          {upgrading ? <LoaderCircle size={16} className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <RefreshCw size={16} className="size-4" aria-hidden />}
          <span className="min-w-0 flex-1">{upgrading ? t`Updating this computer…` : t`Update this computer`}</span>
        </Button>
        <p role={upgradeFailed ? "alert" : undefined} className={`pt-1 text-[11px] ${upgradeFailed ? "text-destructive" : "text-muted-foreground"}`}>
          {upgradeFailed ? t`The update did not finish. This computer keeps its current version.` : t`A one-time update. Afterwards this computer updates itself.`}
        </p>
      </div>
    )}
    {!mini && !unavailable && (hasError || (requested && (busy || needsIdentity)) || (expanded && active) || waiting) && (
      <div className="px-2 pb-1 text-[11px]">
        <p role={hasError ? "alert" : "status"} className={hasError ? "text-destructive" : "text-muted-foreground"}>{detail}</p>
      </div>
    )}
  </div>;
  return unavailable ? <BrowserContributionControl mini={mini} /> : controls;
}

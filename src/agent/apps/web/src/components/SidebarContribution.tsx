import { useLingui } from "@lingui/react/macro";
import { productBrand } from "@rakazo/contracts";
import { Button, buttonVariants } from "@rakazo/ui-web";
import { ArrowUpRight, Cpu, LoaderCircle, Pause, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { desktopBridge } from "../lib/desktop";
import { rpc } from "../lib/rpc";

type Status = Awaited<ReturnType<typeof rpc.models.contributionStatus>>;
// The worker's entry file is served directly even when directory indexes are unavailable.
const browserWorkerUrl = new URL("/browser/index.html", productBrand.apiBaseUrl).href;

/** Shared sidebar; starting compute is an explicit user action, never an effect. */
export function SidebarContribution({ mini = false }: { mini?: boolean }) {
  const { t } = useLingui();
  const desktop = desktopBridge();
  const runtime = desktop?.runtime;
  const [node, setNode] = useState<Status | null>(null);
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [needsIdentity, setNeedsIdentity] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const [supported, setSupported] = useState(Boolean(runtime));
  const mounted = useRef(true);
  const reading = useRef(false);
  const operating = useRef(false);
  const revision = useRef(0);
  async function refresh() {
    if (!runtime || reading.current || operating.current) return;
    const epoch = revision.current;
    reading.current = true;
    try {
      const local = await runtime.status();
      const missingRuntime = local.enrolled && !local.installed;
      if (mounted.current && epoch === revision.current) {
        setSupported(local.supported);
        setNeedsIdentity(local.installed && local.enrolled && !local.nodeId);
        setIncomplete(missingRuntime);
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
    if (busy || operating.current) return;
    if (!runtime || !supported) { window.location.assign(browserWorkerUrl); return; }
    const action = node?.enabled === true ? "pause" : "resume";
    revision.current++; operating.current = true;
    setRequested(true); setBusy(true); setError(false);
    try {
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
  const waiting = Boolean(node?.pending);
  const active = node?.enabled === true;
  // A failed lookup before this account ever had a contribution identity is not an
  // error: show the normal invitation instead of a red "check the dashboard" banner.
  const hasError = !incomplete && Boolean(node) && (error || Boolean(node?.rejected));
  const idleLabel = t`Earn credits with your computer`;
  const shortLabel = t`Earn with your computer`;
  const browserLabel = incomplete ? t`Contribute in browser` : idleLabel;
  const label = busy ? needsIdentity ? t`Verifying this computer…` : t`Setting up contribution…`
    : needsIdentity ? t`Verify this computer` : hasError ? t`Retry`
    : waiting ? t`Waiting for this computer…` : active ? t`Pause contribution` : idleLabel;
  const detail = incomplete ? t`The local contribution runtime is missing.`
    : needsIdentity ? error ? t`Could not verify this computer. Try again or open the dashboard.` : t`Verify the existing installation before contributing.`
    : hasError ? t`Could not confirm contribution. Try again or open the dashboard.`
    : !runtime || !supported ? t`Use this browser to contribute while the page stays open.`
    : node && !node.connected ? t`Computer offline. Waiting for reconnection.`
    : active ? t`Credits are added after the network verifies your work.`
    : t`Share this computer’s resources and earn credits for verified work.`;
  const spinning = busy || (waiting && !hasError);
  const Icon = spinning ? LoaderCircle : needsIdentity || hasError ? RefreshCw : active ? Pause : Cpu;
  const actionClass = "h-auto min-h-9 min-w-0 justify-start gap-1.5 px-2 py-1 text-start text-xs font-medium";
  // Without a contribution identity there is nothing to activate here. A local or
  // fresh account has no node yet, so the invitation would only be a dead control.
  if (!node && !busy && (error || !runtime || !supported)) return null;
  return <div className={mini ? "shrink-0 px-2 py-1" : "min-w-0 max-w-full"}>
    <div className="flex min-w-0 items-center">
    {!runtime || !supported || incomplete ? <a href={browserWorkerUrl}
      target="_blank" rel="noopener noreferrer" aria-label={browserLabel}
      title={mini ? browserLabel : detail}
      className={buttonVariants({ variant: "ghost", className: actionClass })}>
      <Cpu className="size-4 shrink-0" aria-hidden="true" />
      {!mini && <><span className="min-w-0 whitespace-normal">{incomplete ? browserLabel : shortLabel}</span><ArrowUpRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" /></>}
    </a> :
    <Button variant="ghost" className={actionClass}
      onClick={() => { if (hasError && !needsIdentity) void refresh(); else void toggle(); }} disabled={busy || (waiting && !hasError)} aria-label={label} title={mini ? `${label}. ${detail}` : detail}>
      {mini ? <Cpu className="size-4 shrink-0" /> : <Icon className={`size-4 shrink-0 ${spinning ? "animate-spin motion-reduce:animate-none" : ""}`} />}
      {!mini && <span className="min-w-0 whitespace-normal">{label === idleLabel ? shortLabel : label}</span>}
    </Button>}
    </div>
    {!mini && (incomplete || hasError || (requested && (busy || needsIdentity)) || active || waiting) && (
      <div className="px-2 pb-1 text-[11px]">
        <p role={hasError ? "alert" : "status"} className={hasError ? "text-destructive" : "text-muted-foreground"}>{detail}</p>
        {(hasError || incomplete) && <a className="text-muted-foreground underline underline-offset-2 hover:text-foreground" href={new URL("/dashboard?view=contribute", productBrand.apiBaseUrl).href}>{t`Open dashboard`}</a>}
      </div>
    )}
  </div>;
}

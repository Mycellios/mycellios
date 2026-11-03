import { useLingui } from "@lingui/react/macro";
import { productBrand } from "@rakazo/contracts";
import { Button, buttonVariants } from "@rakazo/ui-web";
import { Cpu, LoaderCircle, Pause, Play, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { desktopBridge } from "../lib/desktop";
import { rpc } from "../lib/rpc";

type Status = Awaited<ReturnType<typeof rpc.models.contributionStatus>>;

/** Shared sidebar; starting compute is an explicit user action, never an effect. */
export function SidebarContribution({ mini = false }: { mini?: boolean }) {
  const { t } = useLingui();
  const desktop = desktopBridge();
  const runtime = desktop?.runtime;
  const [node, setNode] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [needsIdentity, setNeedsIdentity] = useState(false);
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
      if (mounted.current && epoch === revision.current) {
        setSupported(local.supported);
        setNeedsIdentity(local.installed && local.enrolled && !local.nodeId);
      }
      const value = local.nodeId ? await rpc.models.contributionStatus({ nodeId: local.nodeId }) : null;
      if (mounted.current && epoch === revision.current) { setNode(value); setError(local.enrolled && !local.installed); }
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
    if (!runtime || !supported) { window.location.assign(new URL("/browser/", productBrand.apiBaseUrl).href); return; }
    const action = node?.enabled === true ? "pause" : "resume";
    revision.current++; operating.current = true;
    setBusy(true); setError(false);
    try {
      let local = await runtime.status();
      // A verification click stays read-only even if another process has already
      // published the identity. Starting compute always needs a separate click.
      const verifyingOnly = needsIdentity || (local.enrolled && !local.nodeId);
      if (local.enrolled && !local.installed) throw new Error("The existing runtime installation is incomplete");
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
  const hasError = error || Boolean(node?.rejected);
  const label = busy ? needsIdentity ? t`Verifying this computer…` : t`Setting up contribution…`
    : needsIdentity ? t`Verify this computer` : hasError ? t`Retry`
    : waiting ? t`Waiting for this computer…` : active ? t`Pause contribution` : t`Contribute compute`;
  const detail = needsIdentity ? error ? t`Could not verify this computer. Try again or open the dashboard.` : t`Verify the existing installation before contributing.`
    : hasError ? t`Could not confirm contribution. Try again or open the dashboard.`
    : !runtime || !supported ? t`Use this browser to contribute while the page stays open.`
    : node && !node.connected ? t`Computer offline. Waiting for reconnection.`
    : active ? t`Credits are added after the network verifies your work.`
    : t`Share this computer’s resources and earn credits for verified work.`;
  const spinning = busy || (waiting && !hasError);
  const Icon = spinning ? LoaderCircle : needsIdentity || hasError ? RefreshCw : active ? Pause : Play;
  return <div className={mini ? "shrink-0 px-2 py-1" : "shrink-0 px-3 pt-2"}>
    {!runtime || !supported ? <a href={new URL("/browser/", productBrand.apiBaseUrl).href}
      target="_blank" rel="noopener noreferrer" aria-label={t`Contribute in browser`}
      title={mini ? t`Contribute in browser` : undefined}
      className={buttonVariants({ variant: "ghost", className: "min-h-10 w-full justify-start gap-2 px-2 text-left text-xs font-normal whitespace-normal" })}>
      <Cpu className="size-4 shrink-0" />
      {!mini && <span className="min-w-0 break-words">{t`Contribute in browser`}</span>}
    </a> :
    <Button variant="ghost" className="h-auto min-h-10 w-full justify-start gap-2 px-2 py-2 text-left font-normal"
      onClick={() => { if (hasError && !needsIdentity) void refresh(); else void toggle(); }} disabled={busy || (waiting && !hasError)} aria-label={label} title={mini ? `${label}. ${detail}` : undefined}>
      {mini ? <Cpu className="size-4 shrink-0" /> : <Icon className={`size-4 shrink-0 ${spinning ? "animate-spin motion-reduce:animate-none" : ""}`} />}
      {!mini && <span className="min-w-0 break-words text-xs">{label}</span>}
    </Button>}
    {!mini && <p role={hasError ? "alert" : "status"} className={`px-2 pb-1 text-[11px] leading-relaxed ${hasError ? "text-destructive" : "text-muted-foreground"}`}>{detail}</p>}
    {!mini && hasError && <a className="px-2 text-xs underline" href={new URL("/dashboard?view=contribute", productBrand.apiBaseUrl).href}>{t`Open dashboard`}</a>}
  </div>;
}

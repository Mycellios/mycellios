import { startContributionGrowth, stopContributionGrowth } from "../lib/contribution-growth";
/// <reference types="@webgpu/types" />
import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { LoaderCircle, Pause, Play } from "lucide-react";
import { authClient } from "../lib/auth";
import { setContributionActivity } from "../lib/contribution-activity";
import type { MobileWorkerSnapshot } from "../../../../../mobile/runtime";

type Engine = typeof import("../../../../../mobile/runtime");
/** The same signed browser worker as /browser, loaded only on explicit activation. */
export function BrowserContributionControl({ mini = false }: { mini?: boolean }) {
  const { t } = useLingui();
  const session = authClient.useSession();
  const [state, setState] = useState<MobileWorkerSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const engine = useRef<Engine | null>(null);
  const unsubscribe = useRef<(() => void) | undefined>(undefined);
  const epoch = useRef(0);
  const pending = useRef(false);
  const indicator = useRef(Symbol("browser-contribution"));
  const activationSource = useRef<HTMLElement | null>(null);
  useEffect(() => {
    setState(null); setLoading(false); setFailed(false);
    return () => {
      epoch.current++;
      stopContributionGrowth();
      activationSource.current = null;
      unsubscribe.current?.();
      unsubscribe.current = undefined;
      void engine.current?.stopMobileWorker().catch(() => undefined);
      pending.current = false;
    };
  }, [session.data?.user.id]);
  const active = state?.running === true;
  const preparing = loading || state?.starting === true;
  async function toggle() {
    if (active || preparing) {
      epoch.current++;
      pending.current = false;
      setLoading(false);
      try { await engine.current?.stopMobileWorker(); } catch { setFailed(true); }
      return;
    }
    if (pending.current) return;
    pending.current = true;
    const generation = ++epoch.current;
    setLoading(true); setFailed(false);
    try {
      const module = await import("../../../../../mobile/runtime");
      if (generation !== epoch.current) return;
      engine.current = module;
      module.initializeMobileWorker({ embedded: true });
      unsubscribe.current?.();
      unsubscribe.current = module.subscribeMobileWorker(setState);
      await module.startMobileWorker();
      if (generation === epoch.current) {
        const current = module.getMobileWorkerSnapshot();
        setState(current); setFailed(!current.running && !current.starting);
      }
    } catch { if (generation === epoch.current) { setFailed(true); stopContributionGrowth(); } }
    finally { if (generation === epoch.current) { setLoading(false); pending.current = false; } }
  }
  const verifiedWork = useRef<{ owner: string; count: number } | null>(null);
  useEffect(() => {
    const owner = session.data?.user.id;
    const count = state?.verifiedTasks;
    if (!owner || !active || count === undefined) { verifiedWork.current = null; return; }
    const previous = verifiedWork.current;
    verifiedWork.current = { owner, count };
    // Verification requests an authoritative wallet read; it never mints a reward.
    if (previous?.owner === owner && count > previous.count)
      window.dispatchEvent(new Event("mycellios:contribution-verified"));
  }, [session.data?.user.id, active, state?.verifiedTasks]);
  const label = active || preparing ? t`Pause contribution` : t`Generate AI`;
  const connected = active && state?.connection === "online";
  useEffect(() => {
    const key = indicator.current;
    setContributionActivity(key, connected);
    if (connected && activationSource.current) {
      startContributionGrowth(activationSource.current);
      activationSource.current = null;
    }
    return () => setContributionActivity(key, false);
  }, [connected]);
  return <div data-testid="browser-contribution-control" data-active={connected ? "true" : "false"} className="rk-contribution-control">
    <Button variant="ghost" className="rk-contribution-button justify-between gap-2 px-2 text-xs" aria-label={label}
      aria-pressed={active || preparing} title={label} onClick={event => { if (active || preparing) { activationSource.current = null; stopContributionGrowth(); setContributionActivity(indicator.current, false); } else { activationSource.current = event.currentTarget; startContributionGrowth(event.currentTarget); } void toggle(); }}>
      {!mini && <span className="min-w-0 flex-1 text-start"><span className="block text-sm">{preparing ? t`Activating…` : t`Generate AI`}</span><span className="block text-[11px] text-muted-foreground">{t`Share computing power with the network`}</span></span>}
      <span className={mini ? "rk-contribution-play rk-contribution-play-mini" : "rk-contribution-play"}>
        {preparing ? <LoaderCircle size={22} className="size-5 animate-spin motion-reduce:animate-none" aria-hidden /> : active ? <Pause size={22} className="size-5" fill="currentColor" strokeWidth={0} aria-hidden /> : <Play size={22} className="size-5 ms-0.5" aria-hidden />}
      </span>
    </Button>
    {!mini && (failed || (active && !connected)) && <p className="px-2 text-[11px] text-muted-foreground" role={failed ? "alert" : "status"}>
      {failed ? t`Could not connect. Try again.` : t`Checking connection…`}
    </p>}
  </div>;
}

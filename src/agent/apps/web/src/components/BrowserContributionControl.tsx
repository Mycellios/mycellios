import { eventAgentContext } from "../lib/event-demo-agent";
import { demoApi } from "../lib/event-demo";
import { startContributionGrowth, stopContributionGrowth } from "../lib/contribution-growth";
/// <reference types="@webgpu/types" />
import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { LoaderCircle, Pause, Play } from "lucide-react";
import { authClient } from "../lib/auth";
import { rpc } from "../lib/rpc";
import { setContributionActivity } from "../lib/contribution-activity";
import { browserContributionAvailability } from "../lib/browser-contribution-availability";
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
  const linkedWorker = useRef<string | null>(null);
  const [linked, setLinked] = useState(false);
  const [issue, setIssue] = useState<"service" | "account" | "offline" | null>(null);
  useEffect(() => {
    setState(null); setLoading(false); setFailed(false);
    linkedWorker.current = null; setLinked(false); setIssue(null);
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
  useEffect(() => {
    const demo = eventAgentContext();
    if (!demo) return;
    const timer = window.setTimeout(() => {
      epoch.current++; pending.current = false; setLoading(false); stopContributionGrowth();
      void engine.current?.stopMobileWorker().catch(() => undefined);
      void demoApi(demo.id).pause().catch(() => undefined);
    }, Math.max(0, demo.endsAt - Date.now()));
    return () => clearTimeout(timer);
  }, [session.data?.user.id]);
  const active = state?.running === true;
  const online = active && state?.connection === "online";
  const connected = online && linked;
  const preparing = loading || state?.starting === true || (online && !linked && !issue);
  async function toggle() {
    if (active || preparing) {
      epoch.current++;
      pending.current = false;
      setLoading(false);
      try { await engine.current?.stopMobileWorker(); const demo = eventAgentContext(); if (demo) await demoApi(demo.id).pause(); } catch { setFailed(true); }
      return;
    }
    if (pending.current) return;
    pending.current = true;
    const generation = ++epoch.current;
    setLoading(true); setFailed(false); setIssue(null);
    try {
      const availability = await browserContributionAvailability();
      if (generation !== epoch.current) return;
      if (availability !== "ready") { setIssue(availability === "unavailable" ? "service" : "offline"); stopContributionGrowth(); return; }
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
    if (!owner || !connected || count === undefined) { verifiedWork.current = null; return; }
    const previous = verifiedWork.current;
    verifiedWork.current = { owner, count };
    // Verification requests an authoritative wallet read; it never mints a reward.
    if (previous?.owner === owner && count > previous.count)
      window.dispatchEvent(new Event("mycellios:contribution-verified"));
  }, [session.data?.user.id, connected, state?.verifiedTasks]);
  const label = active || preparing ? t`Pause contribution` : t`Generate AI`;
  useEffect(() => {
    const owner = session.data?.user.id;
    if (!online || !owner) { linkedWorker.current = null; setLinked(false); return; }
    const proof = engine.current?.getMobileWorkerAccountProof();
    if (!proof) { setIssue("account"); void engine.current?.stopMobileWorker().catch(() => undefined); return; }
    const key = owner + ":" + proof.workerId;
    if (linkedWorker.current === key) return;
    const generation = epoch.current;
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, wake: (() => void) | undefined;
    const controller = new AbortController();
    void (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (stopped || generation !== epoch.current) return;
        try {
          const demo = eventAgentContext();
          const result = demo ? await demoApi(demo.id).link(proof)
            : await rpc.models.browserContributionLink({ ...proof, expectedUserId: owner }, {
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
            });
          if (stopped || generation !== epoch.current) return;
          if (result.linked !== true) throw new Error("Link not confirmed");
          linkedWorker.current = key; setLinked(true); setIssue(null); return;
        } catch (error) {
          if (stopped || generation !== epoch.current) return;
          const code = (error as { code?: string } | null)?.code;
          const permanent = ["UNAUTHORIZED", "FORBIDDEN", "CONFLICT", "PRECONDITION_FAILED"].includes(code ?? "");
          if (!permanent && attempt < 2) {
            await new Promise<void>(resolve => { wake = resolve; timer = setTimeout(resolve, 750 * (attempt + 1)); }); continue;
          }
          setIssue(code === "PRECONDITION_FAILED" ? "service" : permanent ? "account" : "offline");
          setLinked(false); stopContributionGrowth();
          await engine.current?.stopMobileWorker().catch(() => undefined); return;
        }
      }
    })();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); wake?.(); };
  }, [online, session.data?.user.id]);
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
    {!mini && !issue && (failed || (active && !connected)) && <p className="px-2 text-[11px] text-muted-foreground" role={failed ? "alert" : "status"}>
      {failed ? t`Could not connect. Try again.` : t`Checking connection…`}
    </p>}
    {!mini && issue && <p className="px-2 text-[11px] text-muted-foreground" role="status">
      {issue === "service" ? t`Browser earnings aren't available yet.` : issue === "account" ? t`Your account could not be linked. Try again.` : t`Could not connect. Try again.`}
      {" "}<button type="button" className="underline underline-offset-2" onClick={() => void toggle()}>{t`Try again`}</button>
    </p>}
  </div>;
}

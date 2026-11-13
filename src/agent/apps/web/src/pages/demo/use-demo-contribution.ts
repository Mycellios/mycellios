import { useCallback, useEffect, useRef, useState } from "react";
import { demoApi } from "../../lib/event-demo";
import type { MobileWorkerSnapshot } from "../../../../../../mobile/runtime";
type Runtime = typeof import("../../../../../../mobile/runtime");

/** Guest ownership goes only to the event route; normal account RPCs stay protected. */
export function useDemoContribution(id: string, open: boolean, refresh: () => void) {
  const runtime = useRef<Runtime | null>(null), epoch = useRef(0), busy = useRef(false);
  const [snapshot, setSnapshot] = useState<MobileWorkerSnapshot | null>(null);
  const [preparing, setPreparing] = useState(false), [linked, setLinked] = useState(false), [failed, setFailed] = useState(false);
  const unsubscribe = useRef<(() => void) | undefined>(undefined);
  const linkedWorker = useRef<string | null>(null), previousTasks = useRef(0);
  const stop = useCallback(async () => {
    epoch.current++; busy.current = false; linkedWorker.current = null;
    setPreparing(false); setLinked(false);
    await runtime.current?.stopMobileWorker().catch(() => undefined);
    await demoApi(id).pause().catch(() => undefined);
  }, [id]);
  useEffect(() => {
    if (!linked) return;
    window.addEventListener("mycellios:contribution-verified", refresh);
    return () => window.removeEventListener("mycellios:contribution-verified", refresh);
  }, [linked, refresh]);
  useEffect(() => () => {
    epoch.current++; unsubscribe.current?.();
    void runtime.current?.stopMobileWorker().catch(() => undefined);
  }, [id]);
  useEffect(() => { if (!open && (snapshot?.running || preparing || linked)) void stop(); }, [open, stop, snapshot?.running, preparing, linked]);
  async function toggle() {
    if (snapshot?.running || preparing) { await stop(); return; }
    if (!open || busy.current) return;
    busy.current = true; const current = ++epoch.current;
    setPreparing(true); setFailed(false);
    try {
      const engine = await import("../../../../../../mobile/runtime");
      if (current !== epoch.current) return;
      runtime.current = engine; engine.initializeMobileWorker({ embedded: true });
      unsubscribe.current?.(); unsubscribe.current = engine.subscribeMobileWorker(setSnapshot);
      await engine.startMobileWorker();
      if (current !== epoch.current) return;
      const proof = engine.getMobileWorkerAccountProof();
      if (!proof || engine.getMobileWorkerSnapshot().connection !== "online") throw new Error();
      await demoApi(id).link(proof);
      if (current !== epoch.current) { await engine.stopMobileWorker(); return; }
      linkedWorker.current = proof.workerId; setLinked(true); refresh();
    } catch {
      if (current === epoch.current) { setFailed(true); setLinked(false); await runtime.current?.stopMobileWorker().catch(() => undefined); }
    } finally { if (current === epoch.current) { setPreparing(false); busy.current = false; } }
  }
  useEffect(() => {
    const count = snapshot?.verifiedTasks ?? 0;
    if (count > previousTasks.current && linked) refresh();
    previousTasks.current = count;
    // A lost connection cannot remain green; resume requires a fresh explicit Play.
    if (linked && snapshot?.connection !== "online") { setLinked(false); linkedWorker.current = null; }
  }, [snapshot?.verifiedTasks, snapshot?.connection, linked, refresh]);
  return { snapshot, preparing, linked, failed, toggle };
}

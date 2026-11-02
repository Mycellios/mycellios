import { useCallback, useEffect, useRef, useState } from "react";
import type { NetworkSnapshot, NetworkTelemetryHistory, NetworkHistoryRange } from "./NetworkPage";
import { parseStatsHistory, parseStatsSnapshot } from "./stats-model";

export function usePublicStats(range: NetworkHistoryRange, initialSnapshot?: NetworkSnapshot, initialHistory?: NetworkTelemetryHistory) {
  const [snapshot, setSnapshot] = useState(initialSnapshot ?? null), [history, setHistory] = useState(initialHistory ?? null);
  const [snapshotError, setSnapshotError] = useState(""), [historyError, setHistoryError] = useState("");
  const [loading, setLoading] = useState(!initialSnapshot), [historyLoading, setHistoryLoading] = useState(!initialHistory);
  const snapshotRequest = useRef<AbortController | null>(null), historyRequest = useRef<AbortController | null>(null);
  const refreshSnapshot = useCallback(async () => {
    snapshotRequest.current?.abort();
    const controller = new AbortController(); snapshotRequest.current = controller; setLoading(true);
    try {
      const response = await fetch("/public/v1/snapshot", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
      if (!response.ok) throw new Error(`Public snapshot unavailable (HTTP ${response.status}).`);
      const next = parseStatsSnapshot(await response.json());
      if (!controller.signal.aborted) { setSnapshot(next); setSnapshotError(""); }
    } catch (error) { if (!controller.signal.aborted) setSnapshotError(error instanceof Error ? error.message : "The public snapshot is unavailable."); }
    finally { if (snapshotRequest.current === controller) { snapshotRequest.current = null; if (!controller.signal.aborted) setLoading(false); } }
  }, []);
  const refreshHistory = useCallback(async () => {
    historyRequest.current?.abort();
    const controller = new AbortController(); historyRequest.current = controller; setHistoryLoading(true);
    try {
      const response = await fetch(`/public/v1/history?range=${range}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
      if (!response.ok) throw new Error(`Public history unavailable (HTTP ${response.status}).`);
      const next = parseStatsHistory(await response.json(), range);
      if (!controller.signal.aborted) { setHistory(next); setHistoryError(""); }
    } catch (error) { if (!controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : "The public history is unavailable."); }
    finally { if (historyRequest.current === controller) { historyRequest.current = null; if (!controller.signal.aborted) setHistoryLoading(false); } }
  }, [range]);
  useEffect(() => {
    if (initialSnapshot) return;
    let timer = 0;
    const sync = () => { window.clearInterval(timer); if (document.hidden) { snapshotRequest.current?.abort(); snapshotRequest.current = null; } else { void refreshSnapshot(); timer = window.setInterval(() => void refreshSnapshot(), 15000); } };
    sync(); document.addEventListener("visibilitychange", sync);
    return () => { window.clearInterval(timer); snapshotRequest.current?.abort(); snapshotRequest.current = null; document.removeEventListener("visibilitychange", sync); };
  }, [initialSnapshot, refreshSnapshot]);
  useEffect(() => {
    if (initialHistory?.range === range) return;
    let timer = 0;
    const sync = () => { window.clearInterval(timer); if (document.hidden) { historyRequest.current?.abort(); historyRequest.current = null; } else { void refreshHistory(); timer = window.setInterval(() => void refreshHistory(), 60000); } };
    sync(); document.addEventListener("visibilitychange", sync);
    return () => { window.clearInterval(timer); historyRequest.current?.abort(); historyRequest.current = null; document.removeEventListener("visibilitychange", sync); };
  }, [initialHistory, range, refreshHistory]);
  return { snapshot, history: history?.range === range ? history : null, snapshotError, historyError, loading, historyLoading, refreshSnapshot, refreshHistory };
}

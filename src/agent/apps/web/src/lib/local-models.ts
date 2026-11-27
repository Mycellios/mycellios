import type { LocalModelsBridge, LocalModelsStatus } from "@mycellios/contracts";
import { DEVICE_MODEL_PROVIDER_ID } from "@mycellios/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { desktopBridge } from "./desktop";

/** Desktop's local models, or undefined in a browser and in Desktops without them. */
export function localModelsBridge(): LocalModelsBridge | undefined {
  return desktopBridge()?.localModels;
}

export function isDeviceModelChoice(provider: string | null | undefined) {
  return provider === DEVICE_MODEL_PROVIDER_ID;
}

export function formatModelSize(bytes: number) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

/** Live status: read once, then every second while an install runs. */
export function useLocalModels(enabled = true) {
  const bridge = enabled ? localModelsBridge() : undefined;
  const [status, setStatus] = useState<LocalModelsStatus>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  const refresh = useCallback(async () => {
    if (!bridge) return;
    try {
      const next = await bridge.status();
      if (live.current) { setStatus(next); setError(undefined); }
    } catch (cause) { if (live.current) setError(cause); }
  }, [bridge]);
  useEffect(() => {
    live.current = true;
    void refresh();
    return () => { live.current = false; };
  }, [refresh]);
  const installing = Boolean(status?.job && !status.job.error);
  useEffect(() => {
    if (!installing && !busy) return;
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(timer);
  }, [installing, busy, refresh]);
  /** Run one bridge action, then reread the status whatever happened. */
  const act = useCallback(async (action: (bridge: LocalModelsBridge) => Promise<void>) => {
    if (!bridge) return;
    setBusy(true); setError(undefined);
    try { await action(bridge); }
    catch (cause) { if (live.current) setError(cause); throw cause; }
    finally { if (live.current) setBusy(false); await refresh(); }
  }, [bridge, refresh]);
  return { available: Boolean(bridge), status, error, busy, refresh, act };
}

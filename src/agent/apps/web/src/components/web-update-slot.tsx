import { useCallback, useSyncExternalStore } from "react";

let target: HTMLDivElement | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => target;

/** One global update prompt moves here without duplicating update state/actions. */
export function WebUpdateSlot() {
  const ref = useCallback((node: HTMLDivElement | null) => {
    target = node;
    for (const listener of listeners) listener();
  }, []);
  return <div ref={ref} className="shrink-0" data-testid="sidebar-web-update" />;
}

export function useWebUpdateSlot() {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

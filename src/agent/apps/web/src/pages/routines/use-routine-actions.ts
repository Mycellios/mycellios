import type { Routine } from "@rakazo/contracts";
import { useEffect, useRef, useState } from "react";
import { newClientId } from "../../lib/client-id";
import type { RpcClient } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

type ActionState = { busy: boolean; error: string | null; runId?: string };
const IDLE: ActionState = { busy: false, error: null };

/** Commands are explicit and never retried automatically. An uncertain manual run keeps its nonce. */
export function useRoutineActions(client: RpcClient, scope: string, onUpdated: (routine: Routine) => void) {
  const [states, setStates] = useState<Record<string, ActionState>>({});
  const pending = useRef(new Set<string>());
  const nonces = useRef(new Map<string, string>());
  const receipts = useRef(new Map<string, string>());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const update = (id: string, patch: Partial<ActionState>) => {
    if (alive.current) setStates(current => ({ ...current, [id]: { ...(current[id] ?? IDLE), ...patch } }));
  };
  function accepted(id: string) { receipts.current.delete(id); update(id, { runId: undefined }); }
  async function run(routine: Routine) {
    if (pending.current.has(routine.id) || receipts.current.has(routine.id)) return;
    pending.current.add(routine.id); update(routine.id, { busy: true, error: null });
    const key = `mycellios:routine-run:${scope}:${routine.id}`;
    let nonce = nonces.current.get(routine.id);
    try { nonce ??= sessionStorage.getItem(key) ?? undefined; } catch { /* In-memory nonce remains available. */ }
    nonce ??= newClientId(); nonces.current.set(routine.id, nonce);
    try { sessionStorage.setItem(key, nonce); } catch { /* Storage is optional. */ }
    try {
      const result = await client.routines.testRun({ routineId: routine.id, clientNonce: nonce });
      receipts.current.set(routine.id, result.runId);
      update(routine.id, { runId: result.runId });
      nonces.current.delete(routine.id);
      try { sessionStorage.removeItem(key); } catch { /* Storage is optional. */ }
    } catch (error) { update(routine.id, { error: errorText(error) }); }
    finally { pending.current.delete(routine.id); update(routine.id, { busy: false }); }
  }
  async function toggle(routine: Routine) {
    if (pending.current.has(routine.id)) return;
    pending.current.add(routine.id); update(routine.id, { busy: true, error: null });
    try {
      const saved = await client.routines.update({ routineId: routine.id, active: !routine.active });
      if (alive.current) onUpdated(saved);
    } catch (error) { update(routine.id, { error: errorText(error) }); }
    finally { pending.current.delete(routine.id); update(routine.id, { busy: false }); }
  }
  return { state: (id: string) => states[id] ?? IDLE, run, toggle, accepted };
}

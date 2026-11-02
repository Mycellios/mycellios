import type { TaskCost, ThreadMessage } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { rpc } from "../../lib/rpc";

export function useTaskCosts(messages: readonly ThreadMessage[], running: boolean) {
  const ids = [...new Set(messages.filter((m) => m.role === "bot" && m.runId).map((m) => m.runId!))]
    .slice(-100)
    .join("|");
  const last = messages.at(-1)?.id;
  const [costs, setCosts] = useState<ReadonlyMap<string, TaskCost>>(new Map());
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    if (!ids) {
      setCosts(new Map());
      return;
    }
    const runIds = ids.split("|");
    const refresh = async () => {
      try {
        const result = await rpc.usage.tasks({ runIds });
        if (cancelled) return;
        setCosts(new Map(result.map((c) => [c.runId, c])));
        if (result.some((c) => c.state === "pending") && attempts++ < 10)
          timer = setTimeout(refresh, 3000);
      } catch {
        if (!cancelled)
          setCosts(
            new Map(
              runIds.map((runId) => [
                runId,
                { runId, state: "unavailable", amountUsd: null, modelCalls: 0, unpricedCalls: 0 },
              ]),
            ),
          );
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ids, running, last]);
  return costs;
}

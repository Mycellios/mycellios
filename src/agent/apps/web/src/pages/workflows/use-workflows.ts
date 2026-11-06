import {
  type Workflow,
  type WorkflowExecution,
  WorkflowGraphSchema,
  WorkflowSchema,
} from "@rakazo/contracts";
import { useEffect, useRef, useState } from "react";
import type { RpcClient } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

type Draft = Workflow & { dirty?: boolean };
const blank = (): Draft => ({
  id: crypto.randomUUID(),
  name: "Untitled workflow",
  version: 0,
  graph: { nodes: [], edges: [] },
  active: false,
  nextRunAt: null,
  updatedAt: new Date().toISOString(),
  dirty: true,
});
export function useWorkflows(client: RpcClient, scope: string) {
  const key = `mycellios:workflows:${scope}`;
  const [docs, setDocs] = useState<Draft[]>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      if (Array.isArray(stored)) {
        const valid = stored.flatMap((item) => {
          const result = WorkflowSchema.safeParse(item);
          return result.success ? [{ ...result.data, dirty: Boolean(item.dirty) }] : [];
        });
        if (valid.length) return valid;
      }
    } catch {
      /* A fresh local draft remains usable without storage. */
    }
    return [blank()];
  });
  const [selected, select] = useState(() => localStorage.getItem(`${key}:selected`) ?? docs[0]!.id);
  const doc = docs.find((item) => item.id === selected) ?? docs[0]!;
  const current = useRef(doc);
  current.current = doc;
  const [available, setAvailable] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [runs, setRuns] = useState<WorkflowExecution[]>([]),
    [historyError, setHistoryError] = useState(false),
    [probe, setProbe] = useState(0);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(docs));
      localStorage.setItem(`${key}:selected`, selected);
    } catch {
      setError("El navegador no permite guardar el borrador. Exporta una copia antes de cerrar.");
    }
  }, [key, docs, selected]);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        await client.workflows.available();
        const saved = await client.workflows.list();
        if (!live) return;
        setDocs((local) => [
          ...local.filter((item) => item.dirty || !saved.some((row) => row.id === item.id)),
          ...saved.filter((item) => !local.some((row) => row.id === item.id && row.dirty)),
        ]);
        setAvailable(true);
      } catch {
        if (live) setAvailable(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [client, probe]);
  useEffect(() => {
    setRuns([]);
    setHistoryError(false);
    if (!available || !doc.version) return;
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await client.workflows.runs({ id: doc.id });
        if (live) {
          setRuns(result);
          setHistoryError(false);
        }
      } catch {
        if (live) setHistoryError(true);
      } finally {
        if (live) timer = setTimeout(poll, 2000);
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, available, doc.id, doc.version]);
  function update(patch: Partial<Pick<Workflow, "name" | "graph" | "active">>) {
    setDocs((items) =>
      items.map((item) =>
        item.id === doc.id
          ? { ...item, ...patch, dirty: true, updatedAt: new Date().toISOString() }
          : item,
      ),
    );
  }
  async function persist(active?: boolean) {
    const source = current.current;
    if (!available)
      throw new Error(
        "El servidor todavía no admite flujos. El borrador está guardado en este navegador.",
      );
    const saved = source.version
      ? await client.workflows.save({
          id: source.id,
          expectedVersion: source.version,
          name: source.name,
          graph: source.graph,
          active: active ?? source.active,
        })
      : await client.workflows.create({ id: source.id, name: source.name, graph: source.graph });
    if (
      !source.version &&
      (saved.name !== source.name ||
        JSON.stringify(WorkflowGraphSchema.parse(saved.graph)) !==
          JSON.stringify(WorkflowGraphSchema.parse(source.graph)))
    ) {
      // A create may have succeeded before its reply was lost. Keep subsequent local edits.
      if (mounted.current)
        setDocs((items) =>
          items.map((item) =>
            item.id === source.id
              ? {
                  ...item,
                  version: saved.version,
                  active: saved.active,
                  nextRunAt: saved.nextRunAt,
                  dirty: true,
                }
              : item,
          ),
        );
      throw new Error(
        "El servidor ya tiene una copia diferente. Se han conservado tus cambios locales; revisa la versión guardada antes de volver a guardar.",
      );
    }
    if (mounted.current)
      setDocs((items) =>
        items.map((item) => (item.id === source.id ? { ...saved, dirty: false } : item)),
      );
    return saved;
  }
  async function action(work: () => Promise<unknown>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      if (mounted.current) setError(errorText(cause));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const execution = runs[0];
  const running =
    execution?.status === "queued" ||
    execution?.status === "running" ||
    (execution?.status === "cancelled" &&
      Object.values(execution.steps).some((step) => step.status === "running"));
  return {
    doc,
    docs,
    select,
    available,
    busy,
    error,
    historyError,
    runs,
    running,
    execution,
    update,
    retry: () => setProbe((value) => value + 1),
    create: () => {
      const item = blank();
      setDocs((items) => [...items, item]);
      select(item.id);
      setError("");
    },
    save: () => action(() => persist()),
    activate: () =>
      action(async () => {
        if (!current.current.version)
          throw new Error("Guarda el flujo antes de activar su horario.");
        await persist(!current.current.active);
      }),
    run: () =>
      action(async () => {
        if (historyError)
          throw new Error(
            "No se puede comprobar si ya hay una ejecución. Reintenta cuando vuelva la conexión.",
          );
        const source = current.current;
        const nonceKey = `${key}:pending:${source.id}`;
        const prior = localStorage.getItem(nonceKey);
        // A retry after an uncertain response replays the same version and request, never a new run.
        const pending = prior
          ? (JSON.parse(prior) as { nonce: string; version: number; triggerId: string })
          : null;
        const saved = pending ? source : source.dirty || !source.version ? await persist() : source;
        const trigger =
          saved.graph.nodes.find(
            (node) => node.kind === "trigger" && node.trigger !== "schedule",
          ) ?? saved.graph.nodes.find((node) => node.kind === "trigger");
        if (!trigger && !pending) throw new Error("Añade un activador y conéctalo a un Mico.");
        const request = pending ?? {
          nonce: crypto.randomUUID(),
          version: saved.version,
          triggerId: trigger?.id ?? "",
        };
        localStorage.setItem(nonceKey, JSON.stringify(request));
        let result: WorkflowExecution;
        try {
          result = await client.workflows.execute({
            id: saved.id,
            triggerId: request.triggerId,
            expectedVersion: request.version,
            clientNonce: request.nonce,
          });
        } catch (cause) {
          // A definitive rejection created no execution. Retain uncertain requests only.
          const code =
            cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
          if (
            ["BAD_REQUEST", "CONFLICT", "NOT_FOUND", "FORBIDDEN", "UNAUTHORIZED"].includes(
              String(code),
            )
          )
            localStorage.removeItem(nonceKey);
          throw cause;
        }
        localStorage.removeItem(nonceKey);
        if (mounted.current && current.current.id === source.id)
          setRuns((items) => [result, ...items.filter((item) => item.id !== result.id)]);
      }),
    stop: () =>
      action(async () => {
        if (!execution) return;
        await client.workflows.stop({ executionId: execution.id });
        const result = await client.workflows.runs({ id: execution.workflowId });
        if (mounted.current && current.current.id === execution.workflowId) setRuns(result);
      }),
    reload: () =>
      action(async () => {
        const result = await client.workflows.list();
        const item = result.find((row) => row.id === current.current.id);
        if (item) {
          /* Retain a recoverable local copy before explicitly accepting the server version. */ localStorage.setItem(
            `${key}:recovery:${item.id}`,
            JSON.stringify(current.current),
          );
          setDocs((items) =>
            items.map((row) => (row.id === item.id ? { ...item, dirty: false } : row)),
          );
        }
      }),
  };
}

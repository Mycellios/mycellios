import type { InboxTask } from "@rakazo/contracts";
import { useEffect, useRef, useState } from "react";
import type { RpcClient } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

export type PendingTask = {
  text: string;
  botId: string;
  clientNonce: string;
  deadline: number;
  phase: "scheduled" | "sending" | "uncertain";
  artifactIds?: string[];
};
const UNDO_MS = 6000;
function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function useTaskInbox(client: RpcClient, scope: string, initialBotId: string) {
  const key = `mycellios:task-inbox:${scope}`;
  const [draft, setDraft] = useState(() => read(`${key}:draft`, "")),
    [botId, setBotId] = useState(() => read(`${key}:agent`, initialBotId));
  const [pending, setPending] = useState<PendingTask | null>(() => {
    const saved = read<PendingTask | null>(`${key}:pending`, null);
    return saved
      ? { ...saved, phase: saved.phase === "sending" ? "uncertain" : saved.phase }
      : null;
  });
  const [items, setItems] = useState<InboxTask[]>([]),
    [available, setAvailable] = useState<boolean | null>(null),
    [error, setError] = useState("");
  const [unsupported, setUnsupported] = useState(false);
  const loadingError = useRef(false);
  const [receipt, setReceipt] = useState<InboxTask | null>(null),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const alive = useRef(true),
    pendingRef = useRef(pending),
    sending = useRef(false);
  pendingRef.current = pending;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    try {
      localStorage.setItem(`${key}:draft`, JSON.stringify(draft));
      localStorage.setItem(`${key}:agent`, JSON.stringify(botId));
    } catch {
      setError("No se puede guardar el borrador en este navegador.");
    }
  }, [key, draft, botId]);
  function storePending(value: PendingTask | null) {
    pendingRef.current = value;
    try {
      if (value) localStorage.setItem(`${key}:pending`, JSON.stringify(value));
      else localStorage.removeItem(`${key}:pending`);
    } catch {
      /* A pending request remains in memory. */
    }
    if (alive.current) setPending(value);
  }
  async function reload() {
    const result = await client.taskInbox.list();
    if (alive.current) setItems(result);
  }
  useEffect(() => {
    alive.current = true;
    let stopped = false,
      checked = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (!checked) {
          await client.taskInbox.available();
          checked = true;
        }
        const result = await client.taskInbox.list();
        if (!stopped) {
          setAvailable(true);
          setItems(result);
          if (loadingError.current) setError("");
          loadingError.current = false;
          setUnsupported(false);
          timer = setTimeout(poll, 2500);
        }
      } catch (cause) {
        if (!stopped) {
          setAvailable(false);
          loadingError.current = true;
          setUnsupported(
            Boolean(
              cause && typeof cause === "object" && "code" in cause && cause.code === "NOT_FOUND",
            ),
          );
          setError(errorText(cause));
        }
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [client, refresh]);
  async function commit(value: PendingTask) {
    if (sending.current) return;
    sending.current = true;
    storePending({ ...value, phase: "sending" });
    if (alive.current) setBusy(true);
    try {
      const result = await client.taskInbox.start({
        botId: value.botId,
        text: value.text,
        clientNonce: value.clientNonce,
        artifactIds: value.artifactIds,
      });
      storePending(null);
      if (alive.current) {
        setReceipt(result);
        setError("");
        setItems((current) => [result, ...current.filter((item) => item.id !== result.id)]);
      }
    } catch (cause) {
      const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
      if (["BAD_REQUEST", "FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "CONFLICT"].includes(code)) {
        storePending(null);
        const restored = [value.text, draftRef.current].filter(Boolean).join("\n\n");
        try {
          localStorage.setItem(`${key}:draft`, JSON.stringify(restored));
        } catch {
          /* Retain the live draft if browser storage is unavailable. */
        }
        if (alive.current) setDraft(restored);
      } else storePending({ ...value, phase: "uncertain" });
      if (alive.current) setError(errorText(cause));
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    if (pending?.phase !== "scheduled") return;
    const timer = setTimeout(
      () => void commitRef.current(pending),
      Math.max(0, pending.deadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      queueMicrotask(() => {
        if (alive.current) return;
        const current = pendingRef.current;
        if (current?.phase === "scheduled") void commitRef.current(current);
      });
    };
  }, []);
  return {
    draft,
    setDraft,
    botId,
    setBotId,
    pending,
    receipt,
    items,
    available,
    unsupported,
    busy,
    error,
    reload,
    refresh: () => setRefresh((value) => value + 1),
    dismissReceipt: () => setReceipt(null),
    start: (text = draftRef.current, artifactIds?: string[]) => {
      if (!text.trim() || !botId || available !== true || pendingRef.current) return false;
      storePending({
        text: text.trim(),
        botId,
        clientNonce: crypto.randomUUID(),
        deadline: Date.now() + UNDO_MS,
        phase: "scheduled",
        artifactIds,
      });
      setDraft("");
      setError("");
      return true;
    },
    undo: () => {
      const value = pendingRef.current;
      if (value?.phase !== "scheduled") return;
      storePending(null);
      setDraft((current) => [value.text, current].filter(Boolean).join("\n\n"));
      setBotId(value.botId);
      return value;
    },
    reassignPending: (id: string) => {
      const value = pendingRef.current;
      if (value?.phase === "scheduled") storePending({ ...value, botId: id });
    },
    retry: () => {
      const value = pendingRef.current;
      if (value?.phase === "uncertain") void commit(value);
    },
  };
}

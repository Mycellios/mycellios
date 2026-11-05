import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from "@rakazo/ui-web";
import { Plus } from "lucide-react";
import { isRetryableError } from "@rakazo/core";
import { useEffect, useId, useRef, useState } from "react";
import type { RpcClient } from "../lib/rpc";

type TaskTab = { threadId: string; title: string };

/** Conversations belong to the existing Mico; a tab never creates another model or agent. */
export function MicoTaskTabs({ botId, taskThreadId, rpc, onSelect, actions }: {
  botId: string; taskThreadId?: string; rpc: RpcClient; onSelect: (threadId?: string) => void; actions?: import("react").ReactNode;
}) {
  const { t } = useLingui();
  const id = useId();
  const [tabs, setTabs] = useState<TaskTab[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const request = useRef<{ name: string; key: string } | null>(null);
  const alive = useRef(true);
  const creating = useRef(false);
  const opened = useRef(open);
  opened.current = open;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    let pending = false;
    let refused = false;
    setTabs([]);
    setLoadFailed(false);
    const load = async () => {
      if (pending || refused) return;
      pending = true;
      try {
        const rows = await rpc.development.list({ botId });
        if (active) { setTabs(rows); setLoadFailed(false); }
      } catch (cause) { refused = !isRetryableError(cause); if (active) setLoadFailed(true); }
      finally { pending = false; }
    };
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [rpc, botId, revision]);

  async function create() {
    const title = name.trim();
    if (!title || creating.current) return;
    creating.current = true;
    if (request.current?.name !== title) request.current = { name: title, key: `mico-task:${botId}:${crypto.randomUUID()}` };
    setBusy(true);
    setError("");
    try {
      const result = await rpc.development.open({ botId, title, projectKey: `mico:${botId}`, taskKey: request.current.key });
      if (!alive.current) return;
      const select = opened.current;
      request.current = null;
      setName("");
      setOpen(false);
      if (select) onSelect(result.threadId); else setRevision(value => value + 1);
    } catch { if (alive.current) setError(t`Could not create task. Try again.`); }
    finally { creating.current = false; if (alive.current) setBusy(false); }
  }
  return <nav aria-label={t`Mico tasks`} className="flex min-w-0 items-center gap-1">
    <div className="rk-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-lg bg-background p-1">
      <Button size="sm" variant={!taskThreadId ? "secondary" : "ghost"} aria-current={!taskThreadId ? "page" : undefined} onClick={() => onSelect()}>
        <Trans>Main chat</Trans>
      </Button>
      {tabs.map(tab => <Button key={tab.threadId} size="sm" variant={tab.threadId === taskThreadId ? "secondary" : "ghost"}
        className="max-w-48 shrink-0" aria-current={tab.threadId === taskThreadId ? "page" : undefined} title={tab.title}
        onClick={() => onSelect(tab.threadId)}><span className="truncate">{tab.title || t`Task`}</span></Button>)}
      {loadFailed ? <Button size="sm" variant="ghost" onClick={() => setRevision(value => value + 1)}><Trans>Retry</Trans></Button> : null}
    </div>
    {actions}
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button size="icon" variant="ghost" aria-label={t`New task`} />}><Plus size={16} aria-hidden="true" /></PopoverTrigger>
      <PopoverContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
        <form onSubmit={event => { event.preventDefault(); void create(); }} className="space-y-3">
          <label htmlFor={id} className="block text-sm font-medium"><Trans>New task</Trans></label>
          <Input id={id} value={name} maxLength={100} autoFocus disabled={busy} onChange={event => setName(event.target.value)} />
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" size="sm" disabled={busy || !name.trim()}><Trans>Create</Trans></Button>
        </form>
      </PopoverContent>
    </Popover>
  </nav>;
}

import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from "@rakazo/ui-web";
import { ChevronDown, MessageCircle, Plus, X } from "lucide-react";
import { isRetryableError } from "@rakazo/core";
import { useEffect, useId, useRef, useState } from "react";
import type { RpcClient } from "../lib/rpc";

type TaskTab = { threadId: string; title: string };

function readOpenThreads(key: string): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Conversations belong to the existing Mico; a tab never creates another model or agent. */
export function MicoTaskTabs({ botId, taskThreadId, rpc, onSelect, scope }: {
  botId: string;
  taskThreadId?: string;
  rpc: RpcClient;
  onSelect: (threadId?: string) => void;
  scope: string;
}) {
  const { t } = useLingui();
  const id = useId();
  const [tabs, setTabs] = useState<TaskTab[]>([]);
  const storageKey = `mycellios:open-task-tabs:${scope}`;
  const [openIds, setOpenIds] = useState(() => readOpenThreads(storageKey));
  const activeTab = useRef<HTMLButtonElement>(null);
  const [threadPickerOpen, setThreadPickerOpen] = useState(false);
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
  useEffect(() => {
    if (taskThreadId) setOpenIds(ids => ids.includes(taskThreadId) ? ids : [...ids, taskThreadId]);
  }, [taskThreadId]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(openIds)); } catch { /* Storage is optional. */ }
  }, [storageKey, openIds]);
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
        if (active) { setTabs(rows.filter(row => !row.projectKey?.startsWith("project:"))); setLoadFailed(false); }
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
      setTabs(rows => rows.some(row => row.threadId === result.threadId)
        ? rows : [...rows, { threadId: result.threadId, title }]);
      if (select) onSelect(result.threadId); else setRevision(value => value + 1);
    } catch { if (alive.current) setError(t`Could not create task. Try again.`); }
    finally { creating.current = false; if (alive.current) setBusy(false); }
  }
  const tabIds = taskThreadId && !openIds.includes(taskThreadId) ? [...openIds, taskThreadId] : openIds;
  const visibleTabs = tabIds.flatMap(threadId => {
    const tab = tabs.find(row => row.threadId === threadId);
    return tab ? [tab] : threadId === taskThreadId ? [{ threadId, title: t`Task` }] : [];
  });

  useEffect(() => {
    activeTab.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [taskThreadId, tabs.length]);

  function closeTab(threadId: string) {
    setOpenIds(ids => ids.filter(id => id !== threadId));
    if (threadId === taskThreadId) {
      const index = visibleTabs.findIndex(tab => tab.threadId === threadId);
      onSelect(visibleTabs[index - 1]?.threadId);
    }
  }

  return <nav aria-label={t`Mico tasks`} className="app-no-drag flex min-w-0 items-center gap-0.5">
    <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
      {visibleTabs.map(tab => (
        <div key={tab.threadId} data-active={tab.threadId === taskThreadId ? "" : undefined}
          className="group/task-tab relative flex h-7 max-w-40 shrink-0 items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground data-[active]:bg-accent data-[active]:text-foreground @max-[32rem]:not-data-[active]:hidden">
          <Button ref={tab.threadId === taskThreadId ? activeTab : undefined} size="sm" variant="ghost"
            className="h-full min-w-0 gap-1.5 bg-transparent px-2 hover:bg-transparent"
            aria-current={tab.threadId === taskThreadId ? "page" : undefined} title={tab.title}
            onClick={() => onSelect(tab.threadId)}>
            <MessageCircle size={14} aria-hidden="true" />
            <span className="min-w-0 truncate" dir="auto">{tab.title || t`Task`}</span>
          </Button>
          <Button size="icon-sm" variant="ghost" className="absolute inset-y-0 start-0 my-auto size-7 bg-accent opacity-0 focus-visible:opacity-100 group-hover/task-tab:opacity-100 [@media(hover:none)]:opacity-100"
            aria-label={t`Close tab`} onClick={() => closeTab(tab.threadId)}>
            <X size={13} aria-hidden="true" />
          </Button>
        </div>
      ))}
    </div>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button size="icon-sm" variant="ghost" aria-label={t`New task`} />}><Plus size={16} aria-hidden="true" /></PopoverTrigger>
      <PopoverContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
        <form onSubmit={event => { event.preventDefault(); void create(); }} className="space-y-3">
          <label htmlFor={id} className="block text-sm font-medium"><Trans>New task</Trans></label>
          <Input id={id} value={name} maxLength={100} autoFocus disabled={busy} onChange={event => setName(event.target.value)} />
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" size="sm" disabled={busy || !name.trim()}><Trans>Create</Trans></Button>
        </form>
      </PopoverContent>
    </Popover>
    <Popover open={threadPickerOpen} onOpenChange={setThreadPickerOpen}>
      <PopoverTrigger render={<Button size="icon-sm" variant="ghost" aria-label={t`Mico tasks`} title={t`Mico tasks`} />}>
        <ChevronDown size={15} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[60dvh] w-72 max-w-[calc(100vw-2rem)] gap-1 overflow-y-auto p-1">
        {tabs.map(tab => (
          <Button key={tab.threadId} size="sm" variant={tab.threadId === taskThreadId ? "secondary" : "ghost"}
            className="justify-start gap-2" aria-current={tab.threadId === taskThreadId ? "page" : undefined}
            onClick={() => { setThreadPickerOpen(false); onSelect(tab.threadId); }}>
            <MessageCircle size={14} aria-hidden="true" />
            <span className="min-w-0 truncate" title={tab.title} dir="auto">{tab.title || t`Task`}</span>
          </Button>
        ))}
        {loadFailed ? <Button size="sm" variant="ghost" onClick={() => setRevision(value => value + 1)}><Trans>Retry</Trans></Button> : null}
        <Button size="sm" variant="ghost" className="justify-start gap-2" onClick={() => { setThreadPickerOpen(false); setOpen(true); }}>
          <Plus size={14} aria-hidden="true" /><Trans>New task</Trans>
        </Button>
      </PopoverContent>
    </Popover>
  </nav>;
}

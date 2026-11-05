import { Trans, useLingui } from "@lingui/react/macro";
import type { ProjectSummary } from "@rakazo/contracts";
import { Button, Input, OptionSelect, Popover, PopoverContent, PopoverTrigger } from "@rakazo/ui-web";
import { ChevronDown, Folder, MessageSquare, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RpcClient } from "../lib/rpc";

export function SidebarProjects({ projects, rpc, bots, activeThread, creating, onCreating, onRefresh, onSelect, failed }: {
  projects: ProjectSummary[]; rpc: RpcClient; bots: { id: string; name: string }[];
  activeThread?: string; creating: boolean; onCreating(value: boolean): void; onRefresh(): void;
  onSelect(botId: string, threadId: string): void; failed: boolean;
}) {
  const { t } = useLingui();
  const [expanded, expand] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const projectId = useRef(crypto.randomUUID());
  const alive = useRef(true);
  const saving = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const activeProjectId = projects.find(p => p.conversations.some(c => c.threadId === activeThread))?.id;
  useEffect(() => {
    if (activeProjectId) expand(ids => ids.includes(activeProjectId) ? ids : [...ids, activeProjectId]);
  }, [activeProjectId, activeThread]);
  if (!projects.length && !creating) return null;
  return <section aria-label={t`Projects`} className="min-w-0 py-2">
    <div className="flex items-center justify-between px-2 text-xs font-medium text-muted-foreground">
      <span><Trans>Projects</Trans></span>
      <Button variant="ghost" size="icon-sm" aria-label={t`New project`} onClick={() => onCreating(true)}><Plus size={14} /></Button>
    </div>
    {creating ? <form className="space-y-2 p-2" onSubmit={async event => {
      event.preventDefault(); if (saving.current || !name.trim()) return;
      saving.current = true; setBusy(true); setError("");
      try {
        const project = await rpc.development.saveProject({ id: projectId.current, name: name.trim() });
        if (!alive.current) return;
        expand(ids => [...ids, project.id]); projectId.current = crypto.randomUUID(); setName(""); onCreating(false); onRefresh();
      } catch { if (alive.current) setError(t`Could not save the project. Try again.`); }
      finally { saving.current = false; if (alive.current) setBusy(false); }
    }}>
      <Input aria-label={t`Project name`} placeholder={t`Project name`} autoFocus maxLength={100} value={name} disabled={busy} onChange={e => setName(e.target.value)} />
      <div className="flex gap-1"><Button type="submit" size="sm" disabled={busy || !name.trim()}><Trans>Create</Trans></Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onCreating(false)}><Trans>Cancel</Trans></Button></div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      {failed ? <p role="alert" className="text-xs text-destructive"><Trans>Projects are unavailable. Try again.</Trans></p> : null}
    </form> : null}
    {projects.map(project => <div key={project.id} className="min-w-0">
      <div className="flex min-w-0 items-center gap-1">
        <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start gap-2" aria-expanded={expanded.includes(project.id)} onClick={() => expand(ids => ids.includes(project.id) ? ids.filter(id => id !== project.id) : [...ids, project.id])}>
          <ChevronDown size={13} className={expanded.includes(project.id) ? "shrink-0" : "shrink-0 -rotate-90"} /><Folder size={15} className="shrink-0" /><span className="truncate">{project.name}</span>
        </Button>
        <NewProjectConversation project={project} bots={bots} rpc={rpc} onCreated={(botId, threadId) => { onRefresh(); onSelect(botId, threadId); }} />
      </div>
      {expanded.includes(project.id) ? <div className="ms-4 space-y-0.5 border-s border-border ps-1">
        {project.conversations.map(chat => <Button key={chat.threadId} variant={chat.threadId === activeThread ? "secondary" : "ghost"} size="sm" className="w-full min-w-0 justify-start gap-2"
          aria-current={chat.threadId === activeThread ? "page" : undefined} onClick={() => onSelect(chat.botId, chat.threadId)} title={chat.title}>
          <MessageSquare size={14} className="shrink-0" /><span className="truncate">{chat.title}</span>{chat.unread ? <span aria-label={t`Unread`} className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
        </Button>)}
        {!project.conversations.length ? <p className="px-2 py-1 text-xs text-muted-foreground"><Trans>Add a conversation to begin.</Trans></p> : null}
      </div> : null}
    </div>)}
  </section>;
}

function NewProjectConversation({ project, bots, rpc, onCreated }: {
  project: ProjectSummary; bots: { id: string; name: string }[]; rpc: RpcClient; onCreated(botId: string, threadId: string): void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false), [title, setTitle] = useState(""), [botId, setBotId] = useState(bots[0]?.id ?? "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRef<{ botId: string; title: string; key: string } | null>(null), pending = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const bot = bots.some(b => b.id === botId) ? botId : bots[0]?.id ?? "";
  return <Popover open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
    <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t`New conversation in ${project.name}`} />}><Plus size={14} /></PopoverTrigger>
    <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
      <form className="space-y-3" onSubmit={async event => {
        event.preventDefault(); if (pending.current || !title.trim() || !bot) return;
        pending.current = true; setBusy(true); setError("");
        if (request.current?.botId !== bot || request.current?.title !== title.trim())
          request.current = { botId: bot, title: title.trim(), key: `project-task:${crypto.randomUUID()}` };
        try {
          const result = await rpc.development.open({ botId: bot, projectKey: `project:${project.id}`, taskKey: request.current.key, title: title.trim() });
          if (!alive.current) return;
          request.current = null; setOpen(false); setTitle(""); onCreated(bot, result.threadId);
        } catch { if (alive.current) setError(t`Could not create the conversation. Try again.`); }
        finally { pending.current = false; if (alive.current) setBusy(false); }
      }}>
        <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{project.name}</span><Button variant="ghost" size="icon-sm" aria-label={t`Close`} disabled={busy} onClick={() => setOpen(false)}><X size={14} /></Button></div>
        <Input aria-label={t`Conversation title`} placeholder={t`What do you want to work on?`} autoFocus maxLength={100} value={title} disabled={busy} onChange={e => setTitle(e.target.value)} />
        {bots.length > 1 ? <OptionSelect aria-label={t`Mico`} value={bot} options={bots.map(b => ({ value: b.id, label: b.name }))} onValueChange={setBotId} disabled={busy} /> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" size="sm" disabled={busy || !title.trim() || !bot}><Trans>Create conversation</Trans></Button>
      </form>
    </PopoverContent>
  </Popover>;
}

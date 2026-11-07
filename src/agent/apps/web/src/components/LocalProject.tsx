import { Trans, useLingui } from "@lingui/react/macro";
import type { DesktopMicoFolder } from "@rakazo/contracts";
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from "@rakazo/ui-web";
import { FolderOpen, FolderPlus, GitBranch } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { desktopBridge } from "../lib/desktop";
import type { RpcClient } from "../lib/rpc";

export function LocalProject({ botId, rpc, onTask }: {
  botId: string;
  rpc: RpcClient;
  onTask(threadId: string): void;
}) {
  const { t } = useLingui();
  const titleId = useId();
  const computer = desktopBridge()?.computer;
  const [available, setAvailable] = useState(false);
  const [folder, setFolder] = useState<DesktopMicoFolder | null>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ title: string; repositoryId: string; key: string } | null>(null);
  const pending = useRef(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    let current = true;
    setAvailable(false);
    setFolder(null);
    void computer?.projectAvailable?.().then(async allowed => {
      if (!current) return;
      setAvailable(allowed);
      if (!allowed) return;
      const selected = await computer.project?.(botId);
      if (current && !pending.current) setFolder(selected ?? null);
    }).catch(() => undefined);
    return () => { current = false; alive.current = false; };
  }, [botId, computer]);

  if (!available || !computer?.chooseProject) return null;

  async function choose() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (!(await computer!.requestAccess()) || !alive.current) return;
      const selected = await computer!.chooseProject!(botId);
      if (alive.current && selected) setFolder(selected);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : t`Could not continue`);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function createTask() {
    const name = title.trim();
    if (!folder?.repositoryId || !name || pending.current) return;
    const { repositoryId } = folder;
    if (request.current?.title !== name || request.current.repositoryId !== repositoryId)
      request.current = { title: name, repositoryId, key: `project-task:${crypto.randomUUID()}` };
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await rpc.development.saveProject({ id: repositoryId, name: folder.name.slice(0, 100) });
      if (!alive.current) return;
      const task = await rpc.development.open({ botId, title: name, projectKey: `project:${repositoryId}`, taskKey: request.current.key });
      if (!alive.current) return;
      request.current = null;
      setTitle("");
      setCreating(false);
      setOpen(false);
      onTask(task.threadId);
    } catch {
      if (alive.current) setError(t`Could not create task. Try again.`);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return <Popover open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
    <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label={folder ? t`Local folder` : t`Add folder`}
      title={folder?.name ?? t`Add folder`} />}>
      {folder ? <FolderOpen size={16} aria-hidden="true" /> : <FolderPlus size={16} aria-hidden="true" />}
    </PopoverTrigger>
    <PopoverContent align="end" className="w-72 max-w-[calc(100vw-2rem)] space-y-3">
      {folder ? <p className="truncate text-sm font-medium" title={folder.path}>{folder.name}</p> : null}
      {creating ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); void createTask(); }}>
        <label htmlFor={titleId} className="block text-sm font-medium"><Trans>New task in a branch</Trans></label>
        <Input id={titleId} value={title} maxLength={100} autoFocus disabled={busy} onChange={event => setTitle(event.target.value)} />
        <Button type="submit" size="sm" disabled={busy || !title.trim()}><Trans>Create task</Trans></Button>
      </form> : folder?.repositoryId ?
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          <GitBranch size={15} aria-hidden="true" /><Trans>New task in a branch</Trans>
        </Button> : folder ? <p className="text-sm text-muted-foreground"><Trans>Available to this Mico on this PC.</Trans></p> :
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void choose()}>
          <FolderPlus size={15} aria-hidden="true" /><Trans>Add folder</Trans>
        </Button>}
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    </PopoverContent>
  </Popover>;
}

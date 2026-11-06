import { useLingui } from "@lingui/react/macro";
import type { Bot, Space } from "@rakazo/contracts";
import { Input,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@rakazo/ui-web";
import {
  ArrowLeft,
  ChevronDown,
  Download,
  Menu,
  Pause,
  Play,
  Plus,
  Save,
  Square,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { desktopBridge } from "../../lib/desktop";
import type { RpcClient } from "../../lib/rpc";
import { useWorkflows } from "./use-workflows";
import { WorkflowCanvas } from "./WorkflowCanvas";

export function WorkflowWorkspace({
  client,
  scope,
  bots,
  onExit,
  onNavigation,
  spaces,
  spaceId,
  onSpace,
}: {
  client: RpcClient;
  scope: string;
  bots: Bot[];
  onExit: () => void;
  onNavigation: () => void;
  spaces: Space[];
  spaceId: string | null;
  onSpace: (id: string, path: string) => void;
}) {
  const { t, i18n } = useLingui();
  const state = useWorkflows(client, scope),
    { doc } = state;
  const [history, setHistory] = useState(false),
    [renaming, setRenaming] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) nameInput.current?.focus();
  }, [renaming]);
  const locked = state.busy || state.running;
  const name = doc.name === "Untitled workflow" ? t`Untitled workflow` : doc.name;
  function exportDraft() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${doc.name.replace(/[^\p{L}\p{N} -]/gu, "").slice(0, 80) || "workflow"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  const statuses = {
    queued: t`Queued`,
    running: t`Running`,
    completed: t`Completed`,
    failed: t`Failed`,
    cancelled: t`Cancelled`,
  };
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label={t`Workflows`}
      data-testid="workflow-workspace"
    >
      <header
        data-testid="conversation-header"
        className={`${desktopBridge() ? "app-drag" : ""} rk-workflow-header flex h-[51px] min-w-0 shrink-0 items-center gap-2 border-b border-border px-3`}
        style={
          desktopBridge() && desktopBridge()?.platform !== "win32"
            ? { paddingInlineStart: 48 }
            : undefined
        }
      >
        <div className="app-no-drag hidden w-60 shrink-0 md:block">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex max-w-full items-center gap-2 rounded px-2 py-1.5 text-sm font-medium hover:bg-accent"
              aria-label={t`Switch workspace`}
            >
              <span className="truncate">
                {spaces.find((space) => space.id === spaceId)?.name ?? "Mycellios"}
              </span>
              <ChevronDown size={13} className="shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {spaces.map((space) => (
                <DropdownMenuItem
                  key={space.id}
                  onClick={() => {
                    const first = space.bots[0];
                    const group = space.groups[0];
                    onSpace(
                      space.id,
                      first
                        ? `/app/${first.id}?view=workflows`
                        : group
                          ? `/app/g/${group.id}?view=workflows`
                          : "/onboarding",
                    );
                  }}
                >
                  {space.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Button
          className="app-no-drag md:hidden"
          variant="ghost"
          size="icon-sm"
          aria-label={t`Open navigation`}
          onClick={onNavigation}
        >
          <Menu size={17} />
        </Button>
        <Button
          className="app-no-drag"
          variant="ghost"
          size="icon-sm"
          aria-label={t`Back to chat`}
          onClick={onExit}
        >
          <ArrowLeft size={16} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="app-no-drag flex min-w-0 max-w-[40%] items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            disabled={state.busy}
          >
            <span className="truncate">{name}</span>
            <ChevronDown size={13} className="shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {state.docs.map((item) => (
              <DropdownMenuItem key={item.id} onClick={() => state.select(item.id)}>
                {item.name === "Untitled workflow" ? t`Untitled workflow` : item.name}
                {item.dirty ? " ·" : ""}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={state.create}>
              <Plus size={15} />
              {t`New workflow`}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={locked}
              onClick={() => setRenaming(true)}
            >{t`Rename`}</DropdownMenuItem>
            <DropdownMenuItem onClick={exportDraft}>
              <Download size={15} />
              {t`Export workflow`}
            </DropdownMenuItem>
            {state.available && doc.version ? (
              <DropdownMenuItem
                onClick={() => void state.reload()}
              >{t`Restore server version`}</DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <span
          className="ms-auto hidden truncate text-xs text-muted-foreground xl:block"
          role="status"
        >
          {state.available === null ? t`Connecting…` : doc.dirty ? t`Local draft` : t`Saved`}
        </span>
        <div className="app-no-drag ms-auto flex shrink-0 items-center gap-1 xl:ms-0">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t`Save workflow`}
            title={t`Save workflow`}
            disabled={!state.available || locked || !doc.dirty}
            onClick={() => void state.save()}
          >
            <Save size={16} />
          </Button>
          {doc.active ||
          doc.graph.nodes.some((node) => node.kind === "trigger" && node.trigger === "schedule") ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={doc.active ? t`Pause schedule` : t`Activate schedule`}
              title={doc.active ? t`Pause schedule` : t`Activate schedule`}
              disabled={!state.available || locked}
              onClick={() => void state.activate()}
            >
              {doc.active ? <Pause size={15} /> : <Play size={15} />}
            </Button>
          ) : null}
          {state.running ? (
            <Button
              variant="outline"
              size="sm"
              disabled={state.busy}
              onClick={() => void state.stop()}
            >
              <Square size={12} />
              {t`Stop`}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={
                !state.available || state.busy || state.historyError || !doc.graph.nodes.length
              }
              onClick={() => void state.run()}
            >
              <Play size={13} />
              {t`Run`}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t`Execution history`}
            aria-expanded={history}
            onClick={() => setHistory((value) => !value)}
          >
            <ChevronDown size={15} />
          </Button>
        </div>
      </header>
      {renaming ? (
        <form
          className="flex items-center gap-2 border-b border-border px-4 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            setRenaming(false);
          }}
        >
          <Input
            ref={nameInput}
            aria-label={t`Workflow name`}
            className="rk-workflow-input"
            value={doc.name === "Untitled workflow" ? "" : doc.name}
            placeholder={t`Name this workflow…`}
            maxLength={160}
            disabled={locked}
            onChange={(event) => state.update({ name: event.target.value || "Untitled workflow" })}
          />
          <Button size="sm" type="submit">{t`Done`}</Button>
        </form>
      ) : null}
      {state.available === false ? (
        <div
          className="flex items-center gap-3 border-b border-border px-4 py-2 text-xs text-muted-foreground"
          role="status"
        >
          <span>{t`This server needs the workflows update. You can edit and export a local draft.`}</span>
          <Button size="xs" variant="ghost" onClick={state.retry}>{t`Retry`}</Button>
        </div>
      ) : null}
      {state.error || state.historyError ? (
        <p role="alert" className="border-b border-border px-4 py-2 text-xs text-destructive">
          {state.error ||
            t`Execution status unavailable. Running is disabled until the connection returns.`}
        </p>
      ) : null}
      {doc.active && doc.nextRunAt ? (
        <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          {t`Next execution`}: {new Date(doc.nextRunAt).toLocaleString(i18n.locale || "en")}
        </p>
      ) : null}
      {history ? (
        <section
          className="rk-scroll max-h-52 shrink-0 overflow-y-auto border-b border-border p-3 text-xs"
          aria-label={t`Execution history`}
        >
          {state.runs.length
            ? state.runs.map((run) => (
                <div key={run.id} className="flex flex-wrap gap-3 py-1">
                  <span>{statuses[run.status]}</span>
                  <time>{new Date(run.createdAt).toLocaleString(i18n.locale || "en")}</time>
                  <span>
                    {t`Version`} {run.version}
                  </span>
                  {run.error ? <span className="text-destructive">{run.error}</span> : null}
                </div>
              ))
            : t`No runs yet`}
        </section>
      ) : null}
      {state.execution?.error ? (
        <p role="alert" className="border-b border-border px-4 py-2 text-xs text-destructive">
          {state.execution.error}
        </p>
      ) : null}
      <WorkflowCanvas
        key={doc.id}
        graph={doc.graph}
        onChange={(graph) => state.update({ graph })}
        bots={bots}
        execution={state.execution?.version === doc.version ? state.execution : undefined}
        locked={locked}
      />
    </section>
  );
}

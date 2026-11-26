import { useLingui } from "@lingui/react/macro";
import type { Bot, Space, WorkflowGraph, WorkflowRestartRequest } from "@mycellios/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from "@mycellios/ui-web";
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
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { desktopDragClass } from "../../lib/desktop";
import type { RpcClient } from "../../lib/rpc";
import { selectedSpaceLabel, spaceLabel } from "../../lib/space-label";
import { useWorkflows } from "./use-workflows";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { WorkflowVersionHistory } from "./WorkflowVersionHistory";
import { WorkflowWebhook } from "./WorkflowWebhook";
import { exportWorkflowDraft, importWorkflowDraft } from "./workflow-transfer";

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
    [versions, setVersions] = useState(false),
    [webhook, setWebhook] = useState(false),
    [renaming, setRenaming] = useState(false);
  const [shownRunId, setShownRunId] = useState<string>();
  const [restart, setRestart] = useState<Omit<WorkflowRestartRequest, "clientNonce">>();
  const shownRun = state.runs.find(run => run.id === shownRunId) ?? state.execution;
  const canvasExecution = shownRun?.workflowId === doc.id && shownRun.version === doc.version && !doc.dirty
    ? shownRun
    : undefined;

  const nameInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<{ text: string; error: boolean; draftId?: string } | null>(null);
  const workspaceMicos = bots.filter(bot => bot.spaceId === spaceId);
  useEffect(() => {
    if (renaming) nameInput.current?.focus();
  }, [renaming]);
  const locked = state.busy || state.running;
  const name = doc.name === "Untitled workflow" ? t`Untitled workflow` : doc.name;
  const summaryTemplate = t({ id: "workflow.template.summary", message: "Summarize a text" });
  const reviewTemplate = t({ id: "workflow.template.review", message: "Draft and review" });
  function createTemplate(kind: "summary" | "review") {
    const review = kind === "review";
    const graph: WorkflowGraph = {
      nodes: [
        { id: "start", kind: "trigger", trigger: "manual", title: "", text: "", x: 0, y: 0 },
        {
          id: "input", kind: "prompt", title: t({ id: "workflow.template.input", message: "Add your text here" }),
          text: "", x: 320, y: 0,
        },
        {
          id: "mico", kind: "agent", title: "", x: 640, y: 0,
          text: review
            ? t({ id: "workflow.template.draft", message: "Write a concise draft using only the supplied text." })
            : t({ id: "workflow.template.summarize", message: "Summarize the supplied text in three bullets." }),
        },
        ...(review ? [{
          id: "review", kind: "approval" as const, title: "", x: 960, y: 0,
          text: t({ id: "workflow.template.approve", message: "Approve this draft to finish the workflow." }),
        }] : []),
        { id: "output", kind: "output", title: "", text: "", x: review ? 1280 : 960, y: 0 },
      ],
      edges: [
        { id: "start-input", from: "start", to: "input" },
        { id: "input-mico", from: "input", to: "mico" },
        ...(review ? [{ id: "mico-review", from: "mico", to: "review" }] : []),
        { id: "to-output", from: review ? "review" : "mico", to: "output" },
      ],
    };
    const draftId = state.importDraft({ name: review ? reviewTemplate : summaryTemplate, graph });
    setImportStatus({
      text: t`Choose a Mico for each unassigned step before running the workflow.`,
      error: false,
      draftId,
    });
  }

  function exportDraft() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(exportWorkflowDraft(doc, workspaceMicos), null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${doc.name.replace(/[^\p{L}\p{N} -]/gu, "").slice(0, 80) || "workflow"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  async function importDraft(file: File) {
    setImportStatus(null);
    try {
      if (file.size > 1024 * 1024) throw new Error("Workflow file too large");
      const draft = importWorkflowDraft(JSON.parse(await file.text()), workspaceMicos);
      if (!draft) throw new Error("Invalid workflow file");
      const draftId = state.importDraft({ name: draft.name, graph: draft.graph });
      if (draft.unassigned) {
        setImportStatus({ text: t`Choose a Mico for each unassigned step before running the workflow.`, error: false, draftId });
      }
    } catch {
      setImportStatus({ text: t`Could not import this workflow file.`, error: true });
    }
  }
  const approval = state.execution?.status === "running"
    ? Object.entries(state.execution.steps).find(([, step]) =>
        step.status === "running" && step.approval?.state === "waiting",
      )
    : undefined;
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
      <input
        ref={importInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-label={t`Workflow file`}
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void importDraft(file);
        }}
      />
      <header
        data-testid="conversation-header"
        className={`${desktopDragClass()} rk-workflow-header rk-window-buttons-clear flex h-[51px] min-w-0 shrink-0 items-center gap-2 border-b border-border px-3`}
      >
        <div className="app-no-drag hidden w-60 shrink-0 md:block">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex max-w-full items-center gap-2 rounded px-2 py-1.5 text-sm font-medium hover:bg-accent"
              aria-label={t`Switch workspace`}
            >
              <span className="truncate">{selectedSpaceLabel(spaces, spaceId)}</span>
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
                  {spaceLabel(space.name)}
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
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t({ id: "workflow.templates", message: "Templates" })}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => createTemplate("summary")}>{summaryTemplate}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => createTemplate("review")}>{reviewTemplate}</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={locked}
              onClick={() => setRenaming(true)}
            >{t`Rename`}</DropdownMenuItem>
            <DropdownMenuItem onClick={exportDraft}>
              <Download size={15} />
              {t`Export workflow`}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={locked} onClick={() => importInput.current?.click()}>
              <Upload size={15} />
              {t`Import workflow`}
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
                !state.available || state.busy || state.historyError || Boolean(state.pendingRestart) || !doc.graph.nodes.length
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
            onClick={() => { setVersions(false); setHistory(value => !value); }}
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
      {importStatus && (!importStatus.draftId || importStatus.draftId === doc.id) ? (
        <p role={importStatus.error ? "alert" : "status"} className={`border-b border-border px-4 py-2 text-xs ${importStatus.error ? "text-destructive" : "text-muted-foreground"}`}>
          {importStatus.text}
        </p>
      ) : null}
      {state.error || state.historyError ? (
        <p role="alert" className="border-b border-border px-4 py-2 text-xs text-destructive">
          {state.error ||
            t`Execution status unavailable. Running is disabled until the connection returns.`}
        </p>
      ) : null}
      {approval && state.execution ? (
        <section aria-label={t`Workflow approval`} className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">{t`Waiting for your approval`}</h2>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm">{approval[1].approval?.message}</p>
          {approval[1].output ? (
            <pre className="rk-scroll mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">{approval[1].output}</pre>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={state.busy} onClick={() => void state.decideApproval(state.execution!.id, approval[0], "approved")}>{t`Approve`}</Button>
            <Button size="sm" variant="outline" disabled={state.busy} onClick={() => void state.decideApproval(state.execution!.id, approval[0], "rejected")}>{t`Reject`}</Button>
          </div>
        </section>
      ) : null}
      {doc.version > 0 && state.available ? (
        <div className="border-b border-border px-4">
          <Button size="xs" variant="ghost" aria-expanded={versions} onClick={() => { setHistory(false); setVersions(value => !value); }}>
            {t`Version history`}
          </Button>
          {doc.graph.nodes.some(node => node.kind === "trigger" && node.trigger === "webhook") || webhook ? (
            <Button size="xs" variant="ghost" aria-expanded={webhook} onClick={() => setWebhook(value => !value)}>{t`Workflow webhook`}</Button>
          ) : null}
        </div>
      ) : null}
      {doc.active && doc.nextRunAt ? (
        <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          {t`Next execution`}: {new Date(doc.nextRunAt).toLocaleString(i18n.locale || "en")}
        </p>
      ) : null}
      {webhook && doc.version > 0 ? (
        <WorkflowWebhook key={`${doc.id}:${doc.version}`} client={client} id={doc.id} version={doc.version} dirty={Boolean(doc.dirty)} />
      ) : null}
      {versions && doc.version > 0 ? (
        <WorkflowVersionHistory key={`${doc.id}:${doc.version}`} client={client} id={doc.id} version={doc.version}
          dirty={Boolean(doc.dirty)} locked={locked} onRestore={state.restoreVersion} />
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
                  {run.version === doc.version && !doc.dirty ? (
                    <Button size="xs" variant="ghost" aria-pressed={shownRun?.id === run.id} onClick={() => setShownRunId(run.id)}>
                      {t({ id: "workflow.history.steps", message: "Show steps" })}
                    </Button>
                  ) : null}
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
      {state.pendingRestart ? (
        <div className="border-b border-border px-4 py-2">
          <Button size="xs" variant="outline" disabled={state.busy || !state.available} onClick={() => void state.restart(state.pendingRestart!)}>
            {t({ id: "workflow.step.retry", message: "Retry step request" })}
          </Button>
        </div>
      ) : null}
      {restart?.id === doc.id ? (
        <AlertDialog open onOpenChange={open => { if (!open) setRestart(undefined); }}>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {restart.mode === "step"
                  ? t({ id: "workflow.step.test", message: "Test this step" })
                  : t({ id: "workflow.step.restart", message: "Run from this step" })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t({ id: "workflow.step.confirm", message: "This uses saved inputs and starts a new execution. Any actions in the steps you run can happen again." })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t`Cancel`}</AlertDialogCancel>
              <AlertDialogAction disabled={locked || doc.dirty || state.historyError || Boolean(state.pendingRestart)} onClick={() => {
                setRestart(undefined);
                setShownRunId(undefined);
                void state.restart(restart);
              }}>{t`Run`}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
      <WorkflowCanvas
        key={doc.id}
        graph={doc.graph}
        onChange={(graph) => state.update({ graph })}
        bots={bots}
        execution={canvasExecution}
        onRestart={canvasExecution && !locked && !state.historyError && !state.pendingRestart
          ? (stepId, mode) => setRestart({ id: doc.id, executionId: canvasExecution.id, stepId, mode, expectedVersion: doc.version })
          : undefined}
        locked={locked}
      />
    </section>
  );
}

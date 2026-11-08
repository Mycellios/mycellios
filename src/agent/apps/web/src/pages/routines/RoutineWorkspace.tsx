import { routineThreadPath } from "../../lib/routine-thread-path";
import { useLingui } from "@lingui/react/macro";
import type { Bot, Routine, RoutineRun, ThreadMessage } from "@rakazo/contracts";
import { isOneShotRoutineCrons } from "@rakazo/core";
import { BotAvatar, Button, NativeSelect, NativeSelectOption, Spinner } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, Menu, PanelRight, Pause, Pencil, Play, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { desktopDragClass } from "../../lib/desktop";
import { useSpaceQueries } from "../../lib/query";
import type { RpcClient } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { statusLabel, statusTone } from "../ActivityList";
import { routineDiagramSummary } from "./routine-summary";
import type { RoutineHistoryState } from "../RoutineRunHistory";
import { RoutineRunHistory } from "../RoutineRunHistory";
import { previewMessageText } from "../shell/chat-shared";
import { RoutineCanvas } from "./RoutineCanvas";
import { ownedRoutines, routineCanRun } from "./routine-diagram";
import { useRoutineActions } from "./use-routine-actions";

const EMPTY_ROUTINES: Routine[] = [];
export function RoutineWorkspace({ bot, scope, client, selectedId, onSelect, onEdit, onAsk, onExit, onNavigation, editorOpen, messages }: {
  bot: Bot;
  scope: string;
  client: RpcClient;
  selectedId: string | null;
  onSelect: (routineId: string) => void;
  onEdit: (routine?: Routine) => void;
  onAsk: (routine: Routine) => void;
  onExit: () => void;
  onNavigation: () => void;
  editorOpen: boolean;
  messages: ThreadMessage[];
}) {
  const { t, i18n } = useLingui();
  const currentQueries = useSpaceQueries();
  const [queries] = useState(currentQueries);
  const queryClient = useQueryClient();
  const listOptions = queries.routines.list.queryOptions({ input: { botId: bot.id } });
  const list = useQuery({ ...listOptions, refetchOnMount: "always", retry: false, refetchInterval: query => query.state.error ? false : 15_000 });
  const routines = ownedRoutines(list.data ?? EMPTY_ROUTINES, bot.id);
  const selected = routines.find(routine => routine.id === selectedId) ?? routines[0];
  const selectedRef = useRef(selected?.id); selectedRef.current = selected?.id;
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [historyStates, setHistoryStates] = useState<Record<string, RoutineHistoryState>>({});
  const [refreshToken, setRefreshToken] = useState(0);
  const actions = useRoutineActions(client, scope, saved => {
    queryClient.setQueryData(listOptions.queryKey, (current: Routine[] | undefined) => current?.map(routine => routine.id === saved.id ? saved : routine));
  });
  const historyChanged = useCallback((routineId: string, state: RoutineHistoryState) => {
    if (selectedRef.current !== routineId) return;
    setHistoryStates(current => ({ ...current, [routineId]: state }));
  }, []);
  const currentHistory = selected ? historyStates[selected.id] : undefined;
  const receipt = selected ? actions.state(selected.id).runId : undefined;
  const observed = currentHistory?.history?.runs.find(run => run.id === receipt);
  const latest = receipt ? observed ?? null : currentHistory?.history?.runs[0] ?? null;
  const waiting = Boolean(receipt && !observed);
  const outputPage = useQuery({
    queryKey: ["routine-output", scope, latest?.id, latest?.taskThreadId, latest?.messageId],
    enabled: Boolean(latest?.messageId),
    retry: false,
    queryFn: ({ signal }) => client.threads.messages({
      ...(latest!.groupId ? { groupId: latest!.groupId } : { botId: latest!.botId, taskThreadId: latest!.taskThreadId }),
      around: { messageId: latest!.messageId! },
    }, { signal }),
  });

  useEffect(() => {
    if (selected && receipt && observed && routineCanRun(observed)) actions.accepted(selected.id);
  }, [selected?.id, receipt, observed?.status]);
  function run(routine: Routine) { void actions.run(routine).then(() => { setRefreshToken(value => value + 1); void list.refetch(); }); }
  function runFor(id: string): RoutineRun | null {
    const pending = actions.state(id).runId;
    const runs = historyStates[id]?.history?.runs;
    return pending ? runs?.find(item => item.id === pending) ?? null : runs?.[0] ?? null;
  }
  function canRun(id: string) {
    const state = historyStates[id];
    return Boolean(state?.history && !state.failed && !actions.state(id).busy && !actions.state(id).runId && routineCanRun(runFor(id)));
  }
  function stateLabel(id: string) {
    const state = historyStates[id];
    const pending = actions.state(id).runId;
    const run = pending ? state?.history?.runs.find(item => item.id === pending) : state?.history?.runs[0];
    if (state?.failed) return <span className="text-warning">{t`Status unavailable`}</span>;
    if (run) return <span className={statusTone(run.status)}>{statusLabel(run.status)}</span>;
    if (pending) return <span>{t`Queued`}</span>;
    return <span className="text-muted-foreground">{state?.history ? t`No runs yet` : t`Select to see execution`}</span>;
  }
  function output(id: string) {
    const run = runFor(id);
    const message = run?.messageId ? [...(outputPage.data?.messages ?? []), ...messages].find(item => item.id === run.messageId) : null;
    return message ? previewMessageText(message) : "";
  }
  const date = (value: string, timeZone?: string) => new Date(value).toLocaleString(i18n.locale || "en", { dateStyle: "medium", timeStyle: "short", timeZone });
  const lastAt = latest?.startedAt ?? latest?.createdAt;
  const selectedState = selected ? actions.state(selected.id) : null;
  const next = selected?.nextRunAt;
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="routine-workspace" aria-label={t`Routines`}>
    <header data-testid="conversation-header" className={`${desktopDragClass()} flex h-[51px] shrink-0 items-center gap-2 border-b border-border px-3`}>
      <Button variant="ghost" size="icon-sm" className="app-no-drag md:hidden" aria-label={t`Open navigation`} onClick={onNavigation}><Menu size={17} /></Button>
      <Button variant="ghost" size="icon-sm" className="app-no-drag" aria-label={t`Back to chat`} onClick={onExit}><ArrowLeft size={16} /></Button>
      <BotAvatar identity={bot.id} color={bot.color} size={21} status={bot.status} /><span className="min-w-0 truncate text-sm font-medium">{bot.name}</span>
      <div className="app-no-drag ms-auto flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon-sm" aria-label={t`Create Routine`} onClick={() => onEdit()}><Plus size={16} /></Button>
        <Button size="sm" disabled={!selected || !canRun(selected.id)} onClick={() => selected && run(selected)}><Play size={13} />{selectedState?.busy ? t`Starting` : t`Run`}</Button>
        <Button variant="ghost" size="icon-sm" aria-label={t`Routine details`} aria-expanded={detailsOpen && !editorOpen} onClick={() => setDetailsOpen(value => !value)}><PanelRight size={16} /></Button>
      </div>
    </header>
    {list.error ? <div role="alert" className="flex items-center gap-3 border-b border-border p-3 text-sm text-destructive">{errorText(list.error)}<Button size="xs" variant="outline" onClick={() => void list.refetch()}>{t`Retry`}</Button></div> : null}
    {selectedState?.error ? <p role="alert" className="border-b border-border px-4 py-2 text-xs text-destructive">{selectedState.error}</p> : null}
    {list.isPending ? <div className="grid flex-1 place-items-center"><Spinner aria-label={t`Loading…`} /></div> : !selected ? <div className="grid flex-1 place-items-center p-6"><div className="flex flex-col items-center gap-3 text-center"><CalendarClock size={28} className="text-muted-foreground" /><p className="text-sm text-muted-foreground">{list.error ? t`Routines unavailable` : t`No routines yet`}</p>{!list.error ? <Button size="sm" onClick={() => onEdit()}><Plus size={15} />{t`Create Routine`}</Button> : null}</div></div> : <>
      <div className="app-no-drag flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <NativeSelect aria-label={t`Select routine`} value={selected.id} onChange={event => onSelect(event.target.value)} className="max-w-full text-xs">
          {routines.map(routine => <NativeSelectOption key={routine.id} value={routine.id}>{routine.name}</NativeSelectOption>)}
        </NativeSelect>
        <span className="ms-auto hidden truncate text-xs text-muted-foreground sm:block">{selected.active ? t`Active` : t`Paused`}</span>
      </div>
      <div className="rk-routine-body">
        <RoutineCanvas bot={bot} routines={routines} selectedId={selected.id} scope={scope} onSelect={onSelect} onEdit={onEdit} onRun={run} canRun={canRun} status={stateLabel} output={output} onAsk={onAsk} />
        <aside data-testid="routine-details" className={`rk-routine-details ${!detailsOpen || editorOpen ? "hidden!" : ""}`} aria-label={t`Routine details`}>
          <h2 className="border-b border-border px-4 py-3 text-sm font-medium">{t`Routine details`}</h2>
          <div className="rk-scroll min-h-0 flex-1 overflow-y-auto p-4 text-xs">
            <div className="flex flex-wrap items-center gap-2" data-testid="routine-current-status">{stateLabel(selected.id)}{lastAt ? <span className="text-muted-foreground">{t`Last execution`}: {date(lastAt)}</span> : null}</div>
            <p className="mt-3 break-words text-muted-foreground">{t`Started by`} {selected.name}</p>
            <h3 className="mb-3 mt-6 text-xs font-medium text-muted-foreground">{t`Steps`}</h3>
            <div className="flex items-center gap-2"><span className="text-muted-foreground">1</span><BotAvatar identity={bot.id} color={bot.color} size={24} /><span className="min-w-0 flex-1 truncate">{bot.name}</span>{stateLabel(selected.id)}</div>
            <p className="mt-4 whitespace-pre-wrap break-words text-muted-foreground">{selected.prompt}</p>
            {output(selected.id) ? <p className="mt-4 whitespace-pre-wrap break-words">{output(selected.id)}</p> : null}
            {latest?.messageId ? <Link className="mt-3 inline-block underline underline-offset-2" to={routineThreadPath(latest)!}>{t`View chat`}</Link> : null}
            <div className="mt-6 border-t border-border pt-4">
              <p>{routineDiagramSummary(selected, i18n.locale)}</p><p className="mt-1 text-muted-foreground">{selected.timezone}</p>
              {next ? <p className="mt-2 text-muted-foreground">{t`Next run`}: {date(next, selected.timezone)}</p> : null}
              {isOneShotRoutineCrons(selected.crons) && selected.lastRunAt ? <p className="mt-2 text-muted-foreground">{t`One-time schedule`}</p> : null}
              <div className="mt-3 flex gap-1"><Button size="xs" variant="outline" onClick={() => onEdit(selected)}><Pencil size={12} />{t`Edit`}</Button><Button size="xs" variant="ghost" disabled={selectedState?.busy} onClick={() => void actions.toggle(selected)}>{selected.active ? <Pause size={12} /> : <Play size={12} />}{selected.active ? t`Pause routine` : t`Resume routine`}</Button></div>
            </div>
            {waiting ? <p role="status" className="mt-3 text-muted-foreground">{t`Queued`}</p> : null}
            <RoutineRunHistory key={selected.id} routineId={selected.id} client={client} refreshToken={refreshToken} pollInterval={5_000} onState={historyChanged} />
          </div>
        </aside>
      </div>
    </>}
  </section>;
}

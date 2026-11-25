import { useLingui } from "@lingui/react/macro";
import type {
  AwaitingReplies as AwaitingRepliesData,
  AwaitingReplyRecipient,
  AwaitingReplyRequest,
  AwaitingWork,
} from "@mycellios/contracts";
import { BotAvatar, Button, DEFAULT_BOT_AVATAR_COLOR, NativeSelect } from "@mycellios/ui-web";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@mycellios/ui-web/components/ui/collapsible";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@mycellios/ui-web/components/ui/sheet";
import { useIsMobile } from "@mycellios/ui-web/hooks/use-mobile";
import { ChevronDown, ChevronUp, Clock, Square, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { RpcClient } from "../lib/rpc";

/** While something is still owed, how often the list checks for answers given elsewhere. */
const AWAITING_POLL_MS = 30_000;

type AwaitingClient = {
  tasks: Pick<
    RpcClient["tasks"],
    "awaitingReplies" | "stopAwaitingReply" | "hideAwaitingReplies" | "controlWork"
  >;
};

const SETTLED = new Set(["replied", "failed", "stopped"]);
const EMPTY: AwaitingRepliesData = { requests: [], work: [] };

export type MobileReplyQueue = { preview: string; messages: ReactNode };

export type RenderAwaitingReplies = (queue?: MobileReplyQueue) => ReactNode;

type ReplyBot = { id: string; name: string; color?: string };

/** The reply activity disclosure and the mobile message queue. */
export function AwaitingReplies({
  rpc,
  botId,
  bots,
  refreshKey,
  mobileQueue,
}: {
  rpc: AwaitingClient;
  botId: string;
  /** The person's Micos, for Reassign. */
  bots: readonly ReplyBot[];
  /** Changes when the chat's turn or messages move, so the list is read again. */
  refreshKey?: string;
  mobileQueue?: MobileReplyQueue;
}) {
  const { t } = useLingui();
  const mobile = useIsMobile();
  const progressId = useId();
  const [disclosure, setDisclosure] = useState<{ botId: string; open: boolean }>();
  const [data, setData] = useState<AwaitingRepliesData>(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  /** Requests hidden here before the server confirms, so Hide answers at once. */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const current = useRef(botId);
  current.current = botId;

  useEffect(() => {
    setData(EMPTY);
    setError(false);
    setHidden(new Set());
  }, [botId]);
  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const tick = () => {
      if (document.visibilityState === "visible") void load();
      else timer = window.setTimeout(tick, AWAITING_POLL_MS);
    };
    const load = async () => {
      try {
        const listed = await rpc.tasks.awaitingReplies({ botId });
        if (!live) return;
        setData(listed);
        const owed = listed.work.length > 0 || listed.requests.some((request) => !request.settled);
        if (owed) timer = window.setTimeout(tick, AWAITING_POLL_MS);
      } catch {
        // The list stays as it was; the next turn change reads it again.
      }
    };
    void load();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [rpc, botId, refreshKey, reload]);

  const requests = data.requests.filter((request) => !hidden.has(request.requestId));
  const hasActivity = requests.length > 0 || data.work.length > 0;
  if (!hasActivity && !mobileQueue) return null;

  async function act(key: string, action: () => Promise<unknown>) {
    if (busy) return;
    const owner = current.current;
    setBusy(key);
    setError(false);
    try {
      await action();
    } catch {
      if (current.current === owner) setError(true);
    } finally {
      if (current.current === owner) {
        setBusy(null);
        setReload((value) => value + 1);
      }
    }
  }

  async function hide(requestIds: string[]) {
    const owner = current.current;
    setError(false);
    setHidden((previous) => new Set([...previous, ...requestIds]));
    try {
      await rpc.tasks.hideAwaitingReplies({ requestIds });
    } catch {
      if (current.current !== owner) return;
      setHidden((previous) => {
        const next = new Set(previous);
        for (const id of requestIds) next.delete(id);
        return next;
      });
      setError(true);
    }
  }

  const settled = hasActivity && !data.work.length && requests.every((request) => request.settled);
  const label = settled ? t`Replies in` : t`Waiting for replies`;
  const recipients = requests.flatMap((request) => request.recipients);
  const total = recipients.length;
  const done = recipients.filter((recipient) => recipient.state === "replied").length;
  const active = recipients.find((recipient) => recipient.state === "needs_you")
    ?? recipients.find((recipient) => recipient.state === "working");
  const open = disclosure?.botId === botId ? disclosure.open : true;
  const name = active?.name;
  const summary = open || !name ? label : active?.state === "needs_you"
    ? t`${name} needs you`
    : t`${name} is working on it`;
  const dismiss = () => void hide(requests.map((request) => request.requestId));
  const activity = hasActivity ? (
    <div className="flex min-w-0 flex-col gap-1">
      {requests.map((request) => (
        <RequestRows
          key={request.requestId}
          request={request}
          bots={bots}
          busy={busy}
          onStop={(recipient) =>
            void act(`${request.requestId}:${recipient.botId}`, () =>
              rpc.tasks.stopAwaitingReply({ requestId: request.requestId, botId: recipient.botId }),
            )
          }
        />
      ))}
      {data.work.map((work) => (
        <WorkRow
          key={work.taskId}
          work={work}
          bots={bots}
          busy={busy}
          onControl={(action, reassignTo) =>
            void act(work.taskId, () =>
              rpc.tasks.controlWork({
                taskId: work.taskId,
                expectedRevision: work.revision,
                action,
                ...(reassignTo ? { botId: reassignTo } : {}),
              }),
            )
          }
        />
      ))}
      {error ? (
        <p
          role="alert"
          className="text-xs text-muted-foreground"
        >{t`The list could not be updated. Try again.`}</p>
      ) : null}
    </div>
  ) : null;

  if (mobile || mobileQueue) {
    const sheetTitle = mobileQueue ? t`Messages waiting to send` : label;
    return (
      <section
        key={botId}
        data-testid="awaiting-replies"
        data-settled={settled || undefined}
        aria-label={sheetTitle}
        className="pointer-events-auto mx-auto mb-2 w-fit min-w-0 max-w-full"
      >
        <Sheet>
          <SheetTrigger
            render={<Button variant="secondary" />}
            aria-label={sheetTitle}
            className="h-11 max-w-full gap-2 rounded-full px-4"
          >
            <Clock aria-hidden="true" />
            <span className="min-w-0 truncate" dir="auto">{mobileQueue?.preview ?? label}</span>
            <ChevronUp aria-hidden="true" />
          </SheetTrigger>
          <SheetContent
            side="bottom"
            showCloseButton={false}
            className="max-h-[85dvh] gap-0 overflow-hidden rounded-t-2xl motion-reduce:transition-none"
          >
            <div className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
              <SheetTitle>{sheetTitle}</SheetTitle>
              <SheetClose render={<Button variant="ghost" size="icon" className="size-11" aria-label={t`Close`} />}>
                <X aria-hidden="true" />
              </SheetClose>
            </div>
            <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {mobileQueue && activity ? <h3 className="text-sm font-medium">{label}</h3> : null}
              {activity}
              {settled ? (
                <Button variant="ghost" onClick={dismiss}>
                  {t`Hide this list`}
                </Button>
              ) : null}
              {mobileQueue?.messages}
            </div>
          </SheetContent>
        </Sheet>
      </section>
    );
  }

  return (
    <section
      data-testid="awaiting-replies"
      data-settled={settled || undefined}
      aria-label={label}
      className="pointer-events-auto mx-auto mb-2 w-full min-w-0 max-w-[42rem]"
    >
      <Collapsible
        open={open}
        onOpenChange={(next) => setDisclosure({ botId, open: next })}
        className="rounded-xl border border-border bg-background"
      >
        <div className="flex min-w-0 items-center gap-1 pe-1">
          <CollapsibleTrigger
            render={<Button variant="ghost" />}
            aria-label={label}
            aria-describedby={total > 1 ? progressId : undefined}
            className="group min-w-0 flex-1 justify-start gap-2 text-start"
          >
            {total > 0 ? (
              <svg viewBox="0 0 16 16" className="size-4 shrink-0 -rotate-90" fill="none" aria-hidden="true">
                <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="2" className="text-border" />
                <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="2" pathLength="1"
                  strokeDasharray={`${done / total} 1`} className="text-primary" />
              </svg>
            ) : <Clock className="text-muted-foreground" aria-hidden="true" />}
            <span className="min-w-0 flex-1 truncate" dir="auto">{summary}</span>
            {total > 1 ? (
              <span id={progressId} className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {t`${done} of ${total} replies in`}
              </span>
            ) : null}
            <ChevronDown className="text-muted-foreground group-aria-expanded:rotate-180" aria-hidden="true" />
          </CollapsibleTrigger>
          {settled ? (
            <Button size="icon-sm" variant="ghost" aria-label={t`Hide this list`} onClick={dismiss}>
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        <CollapsibleContent>
          <div className="max-h-[min(14rem,32dvh)] overflow-y-auto overscroll-contain px-1 pb-1">
            {activity}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

function RequestRows({
  request,
  bots,
  busy,
  onStop,
}: {
  request: AwaitingReplyRequest;
  bots: readonly ReplyBot[];
  busy: string | null;
  onStop: (recipient: AwaitingReplyRecipient) => void;
}) {
  const { t } = useLingui();
  const states = {
    asked: t`Queued`,
    working: t`Working`,
    needs_you: t`Needs you`,
    replied: t`Answered`,
    failed: t`Failed`,
    stopped: t`Stopped`,
  };
  const total = request.recipients.length;
  const done = request.recipients.filter((recipient) => SETTLED.has(recipient.state)).length;
  const group = request.groupName;
  return (
    <div
      data-awaiting-request={request.requestId}
      data-settled={request.settled ? "true" : "false"}
      className="flex flex-col gap-1 rounded-xl bg-muted/40 px-3 py-2"
    >
      {total > 1 || group ? (
        <p className="text-xs font-medium tabular-nums text-muted-foreground" role="status">
          {t`${done} of ${total} replies in`}
          {group ? <span className="ms-1 font-normal">· {t`in ${group}`}</span> : null}
        </p>
      ) : null}
      {request.recipients.map((recipient) => {
        const name = recipient.name;
        const stoppable = recipient.state === "asked" || recipient.state === "working";
        return (
          <div
            key={recipient.botId}
            data-recipient={recipient.botId}
            data-state={recipient.state}
            className="flex min-h-9 min-w-0 items-center gap-2 text-sm pointer-coarse:min-h-11"
          >
            <BotAvatar color={bots.find((bot) => bot.id === recipient.botId)?.color ?? DEFAULT_BOT_AVATAR_COLOR} identity={recipient.botId} size={20} />
            <span className="min-w-0 flex-1 truncate font-medium" dir="auto" title={name}>{name}</span>
            <span className={recipient.state === "failed" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
              {states[recipient.state]}
            </span>
            {stoppable ? (
              <Button
                size="xs"
                variant="ghost"
                className="pointer-coarse:size-11"
                title={t`Stop`}
                aria-label={t`Stop ${name}`}
                disabled={busy !== null}
                onClick={() => onStop(recipient)}
              ><Square aria-hidden="true" /></Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function WorkRow({
  work,
  bots,
  busy,
  onControl,
}: {
  work: AwaitingWork;
  bots: readonly ReplyBot[];
  busy: string | null;
  onControl: (action: "pause" | "resume" | "cancel" | "reassign", botId?: string) => void;
}) {
  const { t } = useLingui();
  const name = work.name;
  if (work.paused) {
    // The stopped task card: continue where it stopped, give it to another Mico, or cancel it.
    return (
      <div
        data-awaiting-work={work.taskId}
        data-state="stopped"
        className="flex flex-col gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2"
      >
        <p className="text-sm" dir="auto">
          {work.stopping ? t`${name} is stopping its task` : t`The task for ${name} is stopped`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="xs"
            disabled={busy !== null || work.stopping}
            onClick={() => onControl("resume")}
          >{t`Continue`}</Button>
          <NativeSelect
            aria-label={t`Reassign task`}
            value=""
            disabled={busy !== null || work.stopping}
            onChange={(event) => {
              if (event.target.value) onControl("reassign", event.target.value);
            }}
          >
            <option value="">{t`Reassign…`}</option>
            {bots
              .filter((bot) => bot.id !== work.botId)
              .map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name}
                </option>
              ))}
          </NativeSelect>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy !== null || work.stopping}
            onClick={() => onControl("cancel")}
          >{t`Cancel task`}</Button>
        </div>
      </div>
    );
  }
  return (
    <div
      data-awaiting-work={work.taskId}
      data-state={work.delegationState}
      className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-sm"
    >
      <span className="min-w-0 flex-1 truncate" dir="auto">
        {work.delegationState === "waiting"
          ? t`${name} waits on other work`
          : t`${name} is working on a delegated task`}
      </span>
      <Button
        size="xs"
        variant="ghost"
        aria-label={t`Stop ${name}`}
        disabled={busy !== null || work.stopping}
        onClick={() => onControl("pause")}
      >{t`Stop`}</Button>
    </div>
  );
}

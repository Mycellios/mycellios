import { useLingui } from "@lingui/react/macro";
import type {
  AwaitingReplies as AwaitingRepliesData,
  AwaitingReplyRecipient,
  AwaitingReplyRequest,
  AwaitingWork,
} from "@mycellios/contracts";
import { Button, NativeSelect } from "@mycellios/ui-web";
import { MessagesSquare, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

/**
 * "Waiting for replies", above a Mico's composer: the teammates its requests still wait on
 * ("{done} of {total} replies in", one row each with Stop), and the tasks it delegated. A
 * stopped delegated task offers Continue, Reassign and Cancel through the revisioned work
 * controls; Continue resumes it where it stopped. Once every answer is in, the list shrinks to
 * one "Replies in" line that hides at once (the server call follows).
 */
export function AwaitingReplies({
  rpc,
  botId,
  bots,
  refreshKey,
}: {
  rpc: AwaitingClient;
  botId: string;
  /** The person's Micos, for Reassign. */
  bots: ReadonlyArray<{ id: string; name: string }>;
  /** Changes when the chat's turn or messages move, so the list is read again. */
  refreshKey?: string;
}) {
  const { t } = useLingui();
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
  if (!requests.length && !data.work.length) return null;

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

  const hint = (recipient: AwaitingReplyRecipient) => {
    const name = recipient.name;
    switch (recipient.state) {
      case "asked":
        return t`${name} picks it up next`;
      case "working":
        return t`${name} is working on it`;
      case "needs_you":
        return t`${name} needs you`;
      case "replied":
        return t`${name} replied`;
      case "failed":
        return t`${name} could not finish`;
      default:
        return t`${name} was stopped`;
    }
  };
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

  if (!data.work.length && requests.every((request) => request.settled)) {
    // Nothing is owed any more: one line saying who answered, and a close button.
    const outcomes = [
      ...new Set(
        requests.flatMap((request) => request.recipients.map((recipient) => hint(recipient))),
      ),
    ].join(" · ");
    return (
      <section
        data-testid="awaiting-replies"
        data-settled="true"
        aria-label={t`Replies in`}
        className="pointer-events-auto mx-auto mb-2 flex w-full min-w-0 max-w-[42rem] items-center gap-2 rounded-2xl border border-border bg-background/95 py-1.5 ps-3 pe-1.5 text-sm shadow-sm backdrop-blur"
      >
        <MessagesSquare size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="shrink-0 text-xs font-medium text-muted-foreground">{t`Replies in`}</span>
        <span className="min-w-0 flex-1 truncate" dir="auto" title={outcomes}>
          {outcomes}
        </span>
        {error ? (
          <span role="alert" className="shrink-0 text-xs text-muted-foreground">
            {t`The list could not be updated. Try again.`}
          </span>
        ) : null}
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t`Hide this list`}
          onClick={() => void hide(requests.map((request) => request.requestId))}
        >
          <X aria-hidden="true" />
        </Button>
      </section>
    );
  }

  return (
    <section
      data-testid="awaiting-replies"
      aria-label={t`Waiting for replies`}
      className="pointer-events-auto mx-auto mb-2 flex w-full max-w-[42rem] flex-col gap-2 rounded-2xl border border-border bg-background/95 px-3 py-2.5 shadow-sm backdrop-blur"
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <MessagesSquare size={14} className="shrink-0" aria-hidden="true" />
        <span className="flex-1">{t`Waiting for replies`}</span>
      </div>
      {requests.map((request) => (
        <RequestRows
          key={request.requestId}
          request={request}
          hint={hint}
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
    </section>
  );
}

function RequestRows({
  request,
  hint,
  busy,
  onStop,
}: {
  request: AwaitingReplyRequest;
  hint: (recipient: AwaitingReplyRecipient) => string;
  busy: string | null;
  onStop: (recipient: AwaitingReplyRecipient) => void;
}) {
  const { t } = useLingui();
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
            className="flex min-w-0 items-center gap-2 text-sm"
          >
            <span className="min-w-0 flex-1 truncate" dir="auto">
              {hint(recipient)}
            </span>
            {stoppable ? (
              <Button
                size="xs"
                variant="ghost"
                aria-label={t`Stop ${name}`}
                disabled={busy !== null}
                onClick={() => onStop(recipient)}
              >{t`Stop`}</Button>
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
  bots: ReadonlyArray<{ id: string; name: string }>;
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

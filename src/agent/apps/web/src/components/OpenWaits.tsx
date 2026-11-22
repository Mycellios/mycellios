import { useLingui } from "@lingui/react/macro";
import type { OpenWait } from "@mycellios/contracts";
import { Button, Disclosure } from "@mycellios/ui-web";
import { Hourglass } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RpcClient } from "../lib/rpc";

/** While waits are shown, how often the card checks whether one woke or was closed elsewhere. */
const WAITS_POLL_MS = 30_000;

type WaitsClient = { tasks: Pick<RpcClient["tasks"], "waits" | "cancelWait"> };

/**
 * The "Open waits" card of a conversation where its Mico parked a request with await_event:
 * what each wait is for, when it gives up and where it stands, the request it will continue,
 * and "Cancel the wait" through the server's durable cancellation. A wait that already woke is
 * never reported as cancelled.
 */
export function OpenWaits({ rpc, botId, threadId, refreshKey }: {
  rpc: WaitsClient;
  botId: string;
  threadId: string;
  /** Changes when the conversation's turn moves, so the waits are read again. */
  refreshKey?: string;
}) {
  const { t, i18n } = useLingui();
  const [waits, setWaits] = useState<OpenWait[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ waitId: string; text: string } | null>(null);
  const [reload, setReload] = useState(0);
  const current = useRef(`${botId}:${threadId}`);
  current.current = `${botId}:${threadId}`;

  useEffect(() => { setWaits([]); setNotice(null); }, [botId, threadId]);
  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    // A hidden page reads nothing; it checks again when the next interval ends.
    const tick = () => {
      if (document.visibilityState === "visible") void load();
      else timer = window.setTimeout(tick, WAITS_POLL_MS);
    };
    const load = async () => {
      try {
        const listed = await rpc.tasks.waits({ botId, threadId });
        if (!live) return;
        setWaits(listed);
        if (listed.length) timer = window.setTimeout(tick, WAITS_POLL_MS);
      } catch {
        // The card stays as it was; the next turn change reads it again.
      }
    };
    void load();
    return () => { live = false; window.clearTimeout(timer); };
  }, [rpc, botId, threadId, refreshKey, reload]);

  if (!waits.length) return null;

  const when = (iso: string) => new Date(iso).toLocaleString(i18n.locale || "en",
    { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const target = (wait: OpenWait) => {
    if (wait.resumeAt) { const time = when(wait.resumeAt); return t`Waits until ${time}`; }
    if (wait.routineId) {
      const routine = wait.routineName;
      return routine ? t`Waits for the next run of ${routine}` : t`Waits for the next run of a routine`;
    }
    return t`Waits for a run to finish`;
  };
  const status = (wait: OpenWait) => {
    switch (wait.status) {
      case "paused": return t`Paused`;
      case "woke": return t`Woke`;
      case "continuing": return t`Continuing the request`;
      default: return t`Waiting`;
    }
  };

  async function cancel(wait: OpenWait) {
    if (busy) return;
    const key = current.current;
    setBusy(wait.waitId);
    setNotice(null);
    try {
      const result = await rpc.tasks.cancelWait({ waitId: wait.waitId });
      if (current.current !== key) return;
      if (result.closed) setWaits(list => list.filter(item => item.waitId !== wait.waitId));
      else setNotice({ waitId: wait.waitId, text: t`This wait already woke, so it was not cancelled. Its request goes on.` });
    } catch {
      if (current.current === key) setNotice({ waitId: wait.waitId, text: t`The wait could not be cancelled. Try again.` });
    } finally {
      if (current.current === key) { setBusy(null); setReload(value => value + 1); }
    }
  }

  return <section data-testid="open-waits" aria-label={t`Open waits`}
    className="mx-auto mt-3 flex w-full max-w-[42rem] flex-col gap-2 rounded-2xl border border-border bg-muted/40 px-3 py-2.5">
    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <Hourglass size={14} className="shrink-0" aria-hidden="true" />
      <span>{t`Open waits`}</span>
      <span className="rounded-full bg-background px-1.5 text-[11px] tabular-nums" aria-hidden="true">{waits.length}</span>
    </div>
    {waits.map(wait => {
      const expires = when(wait.expiresAt);
      const cancellable = wait.status === "waiting" || wait.status === "paused";
      return <div key={wait.waitId} data-open-wait={wait.waitId} data-wait-status={wait.status}
        className="flex flex-col gap-1.5 rounded-xl bg-background/60 px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 flex-1 break-words text-sm" dir="auto">{target(wait)}</span>
          <span role="status" className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            wait.status === "waiting" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>{status(wait)}</span>
        </div>
        {cancellable ? <p className="text-xs text-muted-foreground">{t`Times out ${expires}`}</p> : null}
        <div className="flex flex-wrap items-start gap-2">
          <Disclosure summary={t`Show the request`} summaryClassName="text-xs font-medium" className="min-w-0 flex-1"
            contentClassName="mt-2 flex flex-col gap-2 text-sm">
            <div>
              <p className="text-xs font-medium text-muted-foreground">{t`Saved note`}</p>
              <p className="whitespace-pre-wrap break-words" dir="auto">{wait.note}</p>
            </div>
            {wait.request ? <div>
              <p className="text-xs font-medium text-muted-foreground">{t`Original request`}</p>
              <p className="whitespace-pre-wrap break-words" dir="auto">{wait.request}</p>
            </div> : null}
          </Disclosure>
          {cancellable ? <Button size="xs" variant="ghost" className="ms-auto shrink-0" disabled={busy !== null}
            onClick={() => void cancel(wait)}>
            {busy === wait.waitId ? t`Cancelling…` : t`Cancel the wait`}
          </Button> : null}
        </div>
        {notice?.waitId === wait.waitId ? <p role="alert" className="text-xs text-muted-foreground">{notice.text}</p> : null}
      </div>;
    })}
  </section>;
}

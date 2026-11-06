import { useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import type { Bot, InboxTask, ThreadSnapshot } from "@rakazo/contracts";
import { Button, Spinner } from "@rakazo/ui-web";
import { Archive, ArchiveRestore, ArrowLeft, Maximize2, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AskCard } from "../../components/AskCard";
import type { RpcClient } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { TaskComposer } from "./TaskComposer";
import { taskIsActive } from "./task-sections";

export function TaskDetail({
  item,
  client,
  bot,
  onClose,
  onChanged,
  expanded,
  onExpand,
  transcribe,
  scope,
}: {
  item: InboxTask;
  client: RpcClient;
  bot?: Bot;
  onClose: () => void;
  onChanged: () => void;
  expanded: boolean;
  onExpand: () => void;
  transcribe?: boolean;
  scope: string;
}) {
  const { t } = useLingui();
  const draftKey = `mycellios:task:${scope}:${item.id}`;
  const [snapshot, setSnapshot] = useState<ThreadSnapshot | null>(null),
    [current, setCurrent] = useState(item),
    [error, setError] = useState(""),
    [draft, setDraft] = useState(() => {
      try {
        return localStorage.getItem(`${draftKey}:draft`) ?? "";
      } catch {
        return "";
      }
    });
  const [busy, setBusy] = useState(false),
    [nonce, setNonce] = useState<string | null>(() => {
      try {
        return localStorage.getItem(`${draftKey}:nonce`);
      } catch {
        return null;
      }
    });
  useEffect(() => {
    try {
      localStorage.setItem(`${draftKey}:draft`, draft);
      if (nonce) localStorage.setItem(`${draftKey}:nonce`, nonce);
      else localStorage.removeItem(`${draftKey}:nonce`);
    } catch {
      /* Keep an in-memory draft when storage is unavailable. */
    }
  }, [draftKey, draft, nonce]);
  const [revision, refresh] = useState(0);
  const [loadError, setLoadError] = useState("");
  const inFlight = useRef(false);
  const [olderCursor, setOlderCursor] = useState<number | null | undefined>();
  useEffect(() => {
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await client.taskInbox.read({ id: item.id });
        if (!live) return;
        setSnapshot((previous) => ({
          ...result.thread,
          messages: [
            ...new Map(
              [...(previous?.messages ?? []), ...result.thread.messages].map((message) => [
                message.id,
                message,
              ]),
            ).values(),
          ].sort((a, b) => a.seq - b.seq),
        }));
        setOlderCursor((previous) =>
          previous === undefined ? result.thread.olderCursor : previous,
        );
        setCurrent(result.item);
        setLoadError("");
        const seq = result.thread.messages.at(-1)?.seq;
        if (seq !== undefined && result.item.unread && document.visibilityState === "visible") {
          await client.taskInbox.markRead({ id: item.id, seq });
          if (live) onChanged();
        }
      } catch (cause) {
        if (live) setLoadError(errorText(cause));
      } finally {
        if (live) timer = setTimeout(poll, 1800);
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [item.id, client, revision]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !(event.target as Element)?.closest("[role=menu],[role=dialog],[role=listbox]")
      ) {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  async function action(work: () => Promise<unknown>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
      refresh((value) => value + 1);
      onChanged();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function send(text = draft) {
    if (inFlight.current) return;
    const request = nonce ?? crypto.randomUUID();
    try {
      localStorage.setItem(`${draftKey}:draft`, text);
      localStorage.setItem(`${draftKey}:nonce`, request);
    } catch { setError(t`This browser cannot preserve the message receipt. Retry when storage is available.`); return; }
    setNonce(request);
    await action(async () => {
      try {
        await client.taskInbox.send({ id: item.id, text, clientNonce: request });
      } catch (cause) {
        const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
        if (["BAD_REQUEST", "CONFLICT", "NOT_FOUND", "FORBIDDEN", "UNAUTHORIZED"].includes(code)) {
          setNonce(null); localStorage.removeItem(`${draftKey}:nonce`);
        }
        throw cause;
      }
      setDraft(""); setNonce(null);
      localStorage.removeItem(`${draftKey}:nonce`);
      localStorage.setItem(`${draftKey}:draft`, "");
    });
  }
  return (
    <aside
      className={`rk-task-detail ${expanded ? "rk-task-detail-expanded" : ""}`}
      aria-label={t`Task conversation`}
      data-testid="task-detail"
    >
      <header>
        {expanded ? (
          <Button variant="ghost" size="icon-sm" aria-label={t`Back to tasks`} onClick={onExpand}>
            <ArrowLeft size={15} />
          </Button>
        ) : null}
        <h2 title={item.title}>{item.title}</h2>
        {taskIsActive(current) ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t`Stop task`}
            disabled={busy}
            onClick={() => void action(() => client.taskInbox.stop({ id: item.id }))}
          >
            <Square size={14} />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy || taskIsActive(current)}
          aria-label={current.archivedAt ? t`Restore task` : t`Archive task`}
          onClick={() =>
            void action(() =>
              client.taskInbox.archive({ id: item.id, archived: !current.archivedAt }),
            )
          }
        >
          {current.archivedAt ? <ArchiveRestore size={15} /> : <Archive size={15} />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`Open task in chat`}
          aria-pressed={expanded}
          onClick={onExpand}
        >
          <Maximize2 size={15} />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={t`Close task`} onClick={onClose}>
          <X size={16} />
        </Button>
      </header>
      <div className="rk-task-detail-scroll rk-scroll" data-testid="task-conversation-messages">
        {typeof olderCursor === "number" ? (
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const page = await client.taskInbox.messages({ id: item.id, before: olderCursor });
                setSnapshot((current) =>
                  current
                    ? {
                        ...current,
                        messages: [
                          ...new Map(
                            [...page.messages, ...current.messages].map((message) => [
                              message.id,
                              message,
                            ]),
                          ).values(),
                        ].sort((a, b) => a.seq - b.seq),
                      }
                    : current,
                );
                setOlderCursor(page.olderCursor);
              })
            }
          >{t`Load older messages`}</Button>
        ) : null}
        {!snapshot ? (
          <Spinner aria-label={t`Loading…`} />
        ) : (
          snapshot.messages.map((message) => (
            <div key={message.id} className={`rk-task-message rk-task-message-${message.role}`}>
              {message.blocks.map((block, index) =>
                block.kind === "text" ? (
                  <ChatMarkdown key={index}>{block.text}</ChatMarkdown>
                ) : block.kind === "ask" ? (
                  <AskCard
                    key={index}
                    block={block}
                    canAnswer={block.status !== "answered" && taskIsActive(current)}
                    canDismiss={block.status !== "answered" && taskIsActive(current)}
                    onAnswer={async (answer, username) => {
                      await client.taskInbox.answer({
                        id: item.id,
                        messageId: message.id,
                        runId: message.runId ?? current.runId!,
                        answer,
                        username,
                      });
                      refresh((value) => value + 1);
                      onChanged();
                    }}
                    onDismiss={async () => {
                      await client.taskInbox.answer({
                        id: item.id,
                        messageId: message.id,
                        runId: message.runId ?? current.runId!,
                        answer: "",
                        dismiss: true,
                      });
                      refresh((value) => value + 1);
                      onChanged();
                    }}
                  />
                ) : block.kind === "progress" ? (
                  <p key={index} className="text-xs text-muted-foreground">
                    {block.text}
                  </p>
                ) : block.kind === "file" || block.kind === "image" ? (
                  <Button
                    key={index}
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const artifact = await client.artifacts.get({
                          botId: item.botId,
                          artifactId: block.artifactId,
                        });
                        const bytes = Uint8Array.from(atob(artifact.contentBase64), (char) =>
                          char.charCodeAt(0),
                        );
                        const url = URL.createObjectURL(
                          new Blob([bytes], { type: artifact.mimeType }),
                        );
                        const anchor = document.createElement("a");
                        anchor.href = url;
                        anchor.download = artifact.name;
                        anchor.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      })
                    }
                  >
                    {block.name}
                  </Button>
                ) : null,
              )}
            </div>
          ))
        )}
        {taskIsActive(current) ? (
          <p className="rk-task-live" role="status">
            <span className="rk-task-spinner" />
            {current.status === "waiting_input"
              ? t`Needs your answer`
              : current.progress || t`Working`}
          </p>
        ) : current.error ? (
          <p role="alert" className="text-sm text-destructive">
            {current.error}
          </p>
        ) : null}
      </div>
      <div className="rk-task-detail-composer">
        {error || loadError ? (
          <p className="mb-2 text-xs text-destructive" role="alert">
            {error || loadError}
            <Button
              size="xs"
              variant="ghost"
              onClick={() => refresh((value) => value + 1)}
            >{t`Retry`}</Button>
          </p>
        ) : null}
        {nonce && !busy ? <p role="status" className="mb-2 text-xs text-muted-foreground">{t`This message is awaiting confirmation.`} <Button variant="ghost" size="xs" onClick={() => void send()}>{t`Check the same message`}</Button></p> : null}
        <TaskComposer
          value={draft}
          onChange={(value) => {
            setDraft(value);
            setNonce(null);
          }}
          onSubmit={(text) => void send(text)}
          bots={bot ? [bot] : []}
          botId={item.botId}
          onAgent={() => {}}
          disabled={busy || Boolean(nonce) || Boolean(current.archivedAt)}
          transcribe={transcribe}
        />
      </div>
    </aside>
  );
}

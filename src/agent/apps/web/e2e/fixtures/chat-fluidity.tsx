import { I18nProvider } from "@lingui/react";
import type { ProductEvent, ThreadSnapshot } from "@rakazo/contracts";
import { Profiler, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createFramePublisher } from "../../src/lib/frame-publisher";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import type { RpcClient } from "../../src/lib/rpc";
import { SpaceRpcProvider } from "../../src/lib/space-rpc";
import { reduceThreadSnapshot } from "../../src/lib/thread-events";
import { Composer } from "../../src/pages/shell/composer";
import { usePendingThreadSends } from "../../src/pages/shell/use-pending-thread-sends";
import { FixtureTranscript, threadEvent } from "./thread-fixture";
import "../../src/styles.css";

const immediate = new URLSearchParams(location.search).has("immediate");
const noop = () => {};
const client = { threads: { queue: async () => [] } } as unknown as RpcClient;
const initial: ThreadSnapshot = {
  botId: "bot-1",
  threadId: "thread-1",
  cursor: 0,
  olderCursor: null,
  run: null,
  messages: Array.from({ length: 120 }, (_, index) => ({
    id: `history-${index}`,
    threadId: "thread-1",
    seq: index + 1,
    role: index % 2 ? "bot" : "user",
    createdAt: "2026-11-11T00:00:00.000Z",
    blocks: [{ kind: "text", text: `History message ${index + 1}` }],
  })),
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function ChatFixture() {
  const [snapshot, setSnapshot] = useState(initial);
  const reference = useRef(snapshot);
  const [scope, setScope] = useState("account/space");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const metrics = useRef({ paints: 0, commits: 0, renderMs: 0, events: 0, sends: 0 });
  const pending = usePendingThreadSends(scope, snapshot);
  const queued = useRef<{
    nonce: string;
    threadId: string;
    text: string;
    resolve: (value: boolean) => void;
  } | null>(null);
  const seq = useRef(1000);
  const [publisher] = useState(() =>
    createFramePublisher<ThreadSnapshot>((next) => {
      metrics.current.paints++;
      setSnapshot(next);
    }),
  );
  useEffect(() => () => publisher.cancel(), [publisher]);
  const emit = (part: Partial<ProductEvent>) => {
    const event = threadEvent(++seq.current, part);
    pending.observe(event);
    if (event.threadId !== reference.current.threadId) return;
    const defer =
      !immediate &&
      event.type === "thread.progress" &&
      reference.current.messages.some((message) => message.id === `progress:${event.runId}`);
    reference.current = reduceThreadSnapshot(reference.current, event)!;
    metrics.current.events++;
    publisher.publish(reference.current, defer);
  };
  const onSend = async (text: string, _mentions: unknown, nonce: string) => {
    metrics.current.sends++;
    setSending(true);
    setSendError(null);
    pending.begin({ scope, nonce, threadId: snapshot.threadId, text, attachments: [] });
    return new Promise<boolean>((resolve) => {
      queued.current = { nonce, threadId: snapshot.threadId, text, resolve };
    });
  };
  const acknowledge = (sseFirst = true) => {
    const send = queued.current;
    if (!send) throw new Error("No pending send");
    queued.current = null;
    const messageSeq = ++seq.current;
    const deliver = () =>
      emit({
        threadId: send.threadId,
        type: "thread.message.created",
        payload: {
          messageId: `sent-${messageSeq}`,
          seq: messageSeq,
          role: "user",
          clientNonce: send.nonce,
          blocks: [{ kind: "text", text: send.text }],
        },
      });
    if (sseFirst) deliver();
    pending.accept(send.nonce, messageSeq);
    send.resolve(true);
    setSending(false);
    if (!sseFirst) setTimeout(deliver, 180);
  };
  const reject = () => {
    const send = queued.current;
    if (!send) throw new Error("No pending send");
    queued.current = null;
    pending.remove(send.nonce);
    send.resolve(false);
    setSending(false);
    setSendError("Synthetic send refused");
  };
  const changeThread = () => {
    reference.current = { ...initial, threadId: "another-thread", messages: [] };
    publisher.publish(reference.current);
  };
  const burst = async () => {
    metrics.current = { paints: 0, commits: 0, renderMs: 0, events: 0, sends: 0 };
    emit({ type: "run.started", payload: { trigger: "user" } });
    let text = "";
    for (let index = 0; index < 120; index++) {
      text += `Word ${index}. `;
      emit({ type: "thread.progress", payload: { text, streaming: true } });
      await wait(0);
    }
    emit({
      type: "thread.message.created",
      payload: {
        messageId: "final-reply",
        role: "bot",
        seq: ++seq.current,
        blocks: [{ kind: "text", text }],
      },
    });
    emit({ type: "run.completed", payload: {} });
    await wait(40);
    return { ...metrics.current, cursor: reference.current.cursor, finalText: text };
  };
  // Browser-owned fixture controls only; no server, account or provider is contacted.
  useEffect(() => {
    Object.assign(window, {
      __chatFlow: {
        acknowledge,
        reject,
        changeThread,
        changeScope: () => setScope("another-account/space"),
        burst,
        emit,
        metrics: () => ({ ...metrics.current }),
        pending: () => pending.visible,
      },
    });
  });
  const footer = (
    <SpaceRpcProvider spaceId="fixture" client={client}>
      <Composer
        artifactTarget={{ groupId: "group-1" }}
        activeName="Fixture Mico"
        running={false}
        pendingAttachments={[]}
        attachmentNotice={null}
        sendError={sendError}
        onOpenModels={noop}
        onOpenConnections={noop}
        runError={null}
        runErrorId={null}
        onRunErrorPresented={noop}
        onDismissError={noop}
        sending={sending}
        fileInputRef={useRef<HTMLInputElement>(null)}
        onAttachmentPick={() => true}
        onRemoveAttachment={noop}
        onSend={onSend}
        onStop={async () => {}}
        draftKey={`${scope}:${snapshot.threadId}`}
        enterToSend
      />
    </SpaceRpcProvider>
  );
  return (
    <Profiler
      id="conversation"
      onRender={(_id, _phase, duration) => {
        metrics.current.commits++;
        metrics.current.renderMs += duration;
      }}
    >
      <FixtureTranscript
        messages={snapshot.messages}
        running={false}
        showToolActivity={false}
        pendingMessages={pending.visible}
        footer={footer}
      />
    </Profiler>
  );
}
void bootstrapI18n("en").then(() =>
  createRoot(document.getElementById("root")!).render(
    <I18nProvider i18n={i18n}>
      <ChatFixture />
    </I18nProvider>,
  ),
);

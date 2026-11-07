import { I18nProvider } from "@lingui/react";
import type { ProductEvent, ThreadMessage } from "@rakazo/contracts";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import "../../src/styles.css";
import { FixtureTranscript, reduceThreadEvents } from "./thread-fixture";

const live = new URLSearchParams(location.search).get("live") === "1";

// A bot posts a message_user update mid-turn, keeps calling tools, then replies.
const midTurn: Partial<ProductEvent>[] = [
  {
    type: "thread.message.created",
    payload: {
      messageId: "user-1",
      role: "user",
      blocks: [{ kind: "text", text: "Find time with Sam next week." }],
    },
  },
  { type: "run.started", payload: { trigger: "user" } },
  {
    type: "thread.message.created",
    payload: {
      messageId: "bot-progress",
      role: "bot",
      blocks: [{ kind: "text", text: "Checking your calendars…" }],
    },
  },
  { type: "agent.tool.called", payload: { name: "calendar" } },
];
const events: Partial<ProductEvent>[] = live
  ? [
      ...midTurn,
      { type: "thread.progress", payload: { text: "Still finding a free slot…", streaming: true } },
    ]
  : [
      ...midTurn,
      {
        type: "thread.message.created",
        payload: {
          messageId: "bot-reply",
          role: "bot",
          blocks: [{ kind: "text", text: "Tuesday afternoon is free." }],
        },
      },
      { type: "run.completed" },
    ];
const snapshot = reduceThreadEvents(events);

function MotionFixture() {
  const [messages, setMessages] = useState<ThreadMessage[]>(() =>
    Array.from({ length: 120 }, (_, index) => ({
      id: `history-${index}`, threadId: "thread-1", seq: index + 1,
      role: index % 2 ? "bot" : "user", createdAt: "2026-08-16T00:00:01.000Z",
      blocks: [{ kind: "text", text: `History message ${index + 1}` }],
    })),
  );
  const append = () => setMessages(previous => [...previous, {
    id: `incoming-${previous.length}`, threadId: "thread-1", seq: previous.length + 1,
    role: "bot", createdAt: "2026-08-16T00:00:01.000Z",
    blocks: [{ kind: "text", text: "New reply" }],
  }]);
  return <FixtureTranscript messages={messages} running={false} showToolActivity={false}
    header={<button type="button" onClick={append}>Append reply</button>} />;
}

void bootstrapI18n("en").then(() => {
  createRoot(document.getElementById("root")!).render(
    <I18nProvider i18n={i18n}>
      {new URLSearchParams(location.search).has("motion") ? <MotionFixture /> : <FixtureTranscript
        messages={snapshot.messages}
        running={snapshot.run?.status === "running"}
        showToolActivity={false}
      />}
    </I18nProvider>,
  );
});

import { I18nProvider } from "@lingui/react";
import type { ThreadMessage } from "@rakazo/contracts";
import { createRoot } from "react-dom/client";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { ResponseStyleContext } from "../../src/lib/response-style";
import "../../src/styles.css";
import { FixtureTranscript } from "./thread-fixture";

const at = "2026-08-16T00:00:01.000Z";
const message = (id: string, seq: number, role: ThreadMessage["role"], blocks: ThreadMessage["blocks"]): ThreadMessage =>
  ({ id, threadId: "thread-1", seq, role, createdAt: at, blocks });

// One natural turn: notes between steps, one steps summary, its task list and the answer;
// then a run of Mico-to-Mico messages and a plan card waiting for an answer.
const messages: ThreadMessage[] = [
  message("user-1", 1, "user", [{ kind: "text", text: "Why is the deploy red?" }]),
  message("bot-1", 2, "bot", [
    { kind: "plan", explanation: "Check the deploy", steps: [
      { title: "Read the failing job", status: "done" },
      { title: "Compare with main", status: "done" },
      { title: "Report the cause", status: "running" },
    ] },
    { kind: "text", text: "Checking the failing deploy job first." },
    { kind: "steps", steps: [{ label: "Read the job log", count: 1 }], durationMs: 4_000 },
    { kind: "text", text: "Checking the failing deploy job first." },
    { kind: "text", text: "The image build fails, not the registry." },
    { kind: "steps", steps: [{ label: "Compared with main", count: 2 }], durationMs: 6_000 },
    { kind: "text", text: "The web image build fails on this commit. I need your OK to rerun it on the fixed commit." },
  ]),
  message("bot-2", 3, "bot", [{ kind: "bot_message_sent", toBotId: "devops", toBotName: "DevOps", text: "Status of the deploy?" }]),
  message("bot-3", 4, "bot", [{ kind: "bot_message_sent", toBotId: "developer", toBotName: "Developer", text: "Which commit fixed the build?" }]),
  message("bot-4", 5, "bot", [{ kind: "bot_message_sent", toBotId: "marketing", toBotName: "Marketing", text: "Hold the launch post." }]),
  message("bot-5", 6, "bot", [{
    kind: "ask", text: "On it: rerunning the deploy on the fixed commit.", status: "pending",
    actions: [{ id: "start", label: "Start" }, { id: "alternative", label: "Only check the logs" }, { id: "cancel", label: "Cancel" }],
    plan: {
      steps: [{ label: "First", text: "Rerun the image build" }, { label: "Then", text: "Check the smoke test" }],
      autoStartAt: new Date(Date.now() + 60_000).toISOString(),
    },
  }]),
];

void bootstrapI18n("en").then(() => {
  createRoot(document.getElementById("root")!).render(
    <I18nProvider i18n={i18n}>
      <ResponseStyleContext.Provider value="natural">
        <FixtureTranscript messages={messages} running={false} showToolActivity />
      </ResponseStyleContext.Provider>
    </I18nProvider>,
  );
});

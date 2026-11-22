import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { MessageBlock, ThreadMessage } from "@mycellios/contracts";
import { Button, Toaster } from "@mycellios/ui-web";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BranchOriginDivider } from "../../src/components/BranchOriginDivider";
import { MicoTaskTabs } from "../../src/components/MicoTaskTabs";
import {
  branchableMessageIds,
  branchConversation,
  branchOriginBlock,
  branchSource,
} from "../../src/lib/conversation-branch";
import type { RpcClient } from "../../src/lib/rpc";
import { SpaceRpcProvider } from "../../src/lib/space-rpc";
import { useConversationRows } from "../../src/lib/thread-tabs";
import { MessageHoverActions } from "../../src/pages/shell/message-hover-actions";
import "../../src/styles.css";

// A loopback component fixture: synthetic conversations and RPCs, no account, backend or model.
i18n.load("en", {});
i18n.activate("en");
const scope = "branch-fixture";
const botId = "mico-fixture";
const MAIN = "main";
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 22, 9, minutes)).toISOString();
let seq = 0;
const say = (
  threadId: string,
  role: ThreadMessage["role"],
  text: string,
  minutes: number,
  extra: Partial<ThreadMessage> = {},
): ThreadMessage => ({
  id: `${threadId}-${seq++}`,
  threadId,
  seq,
  role,
  blocks: [{ kind: "text", text }],
  createdAt: at(minutes),
  ...extra,
});
type Row = {
  threadId: string;
  title: string;
  kind: string;
  startedBy: string;
  state: string;
  titleSource?: string;
  branchedFromThreadId?: string | null;
  createdAt: string;
  updatedAt: string;
  deleteAfter?: string | null;
};
const transcripts = new Map<string, ThreadMessage[]>([
  [
    MAIN,
    [
      say(MAIN, "user", "Plan the spring trip with trains", 1),
      say(MAIN, "bot", "Here is a first plan: Madrid, Lyon and Turin by train.", 2),
      say(MAIN, "user", "And the hotels?", 3),
      say(MAIN, "bot", "Two hotels near each station, both under 120 euros a night.", 4),
    ],
  ],
  [
    "trip",
    [
      say("trip", "user", "Estimate the budget for the trip", 5),
      say("trip", "bot", "About 900 euros for trains and hotels.", 6),
      say("trip", "user", "Could it be cheaper?", 7),
      say("trip", "bot", "Night trains bring it down to about 650 euros.", 8),
    ],
  ],
  [
    "notes",
    [
      say("notes", "user", "Packing list", 9),
      say("notes", "bot", "Passport, chargers and a rain jacket.", 10),
    ],
  ],
]);
const rows: Row[] = [
  {
    threadId: "trip",
    title: "Trip budget",
    kind: "conversation",
    startedBy: "user",
    state: "idle",
    createdAt: at(5),
    updatedAt: at(8),
  },
  {
    threadId: "notes",
    title: "Packing notes",
    kind: "conversation",
    startedBy: "user",
    state: "idle",
    createdAt: at(9),
    updatedAt: at(10),
  },
];
// The two conversations start as open tabs.
if (!localStorage.getItem(`mycellios:open-task-tabs:${scope}`))
  localStorage.setItem(`mycellios:open-task-tabs:${scope}`, JSON.stringify(["trip", "notes"]));

const rpc = {
  development: {
    list: async () =>
      rows.map((row) => ({
        projectKey: `mico:${botId}`,
        taskKey: `mico-task:${botId}:${row.threadId}`,
        ...row,
      })),
    branch: async (input: {
      botId: string;
      taskThreadId?: string;
      messageId: string;
      requestId: string;
    }) => {
      const source = input.taskThreadId ?? MAIN;
      const existing = rows.find((row) => row.threadId === `branch-${input.requestId}`);
      if (existing) return { threadId: existing.threadId, title: existing.title, replayed: true };
      const messages = transcripts.get(source) ?? [];
      const end = messages.findIndex((message) => message.id === input.messageId);
      if (end < 0 || messages[end]!.role !== "bot")
        throw new Error("Branch from a Mico reply of a finished turn.");
      const threadId = `branch-${input.requestId}`;
      const sourceRow = rows.find((row) => row.threadId === source);
      const family = rows.filter(
        (row) => sourceRow && row.title.startsWith(`${sourceRow.title} #`),
      ).length;
      const title = sourceRow
        ? `${sourceRow.title} #${family + 2}`
        : ([...messages.slice(0, end)]
            .reverse()
            .find((message) => message.role === "user")
            ?.blocks.find(
              (block): block is Extract<MessageBlock, { kind: "text" }> => block.kind === "text",
            )?.text ?? "Branched conversation");
      const origin: MessageBlock = {
        kind: "branch_origin",
        threadId: source,
        messageId: input.messageId,
        ...(sourceRow ? {} : { main: true as const }),
        title: sourceRow?.title ?? "",
      };
      transcripts.set(threadId, [
        ...messages
          .slice(0, end + 1)
          .map((message, index) => ({
            ...message,
            id: `${threadId}-${index}`,
            threadId,
            seq: index,
          })),
        {
          id: `${threadId}-origin`,
          threadId,
          seq: end + 1,
          role: "system" as const,
          blocks: [origin],
          createdAt: new Date().toISOString(),
        },
      ]);
      rows.push({
        threadId,
        title,
        kind: "conversation",
        startedBy: "branch",
        state: "idle",
        titleSource: "auto",
        branchedFromThreadId: source === MAIN ? null : source,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return { threadId, title, replayed: false };
    },
  },
} as unknown as RpcClient;

function Preview() {
  const [threadId, select] = useState<string>();
  const [running, setRunning] = useState(false);
  const [jump, setJump] = useState("");
  const listed = useConversationRows(scope);
  const current = threadId ?? MAIN;
  const messages = transcripts.get(current) ?? [];
  const branchable = branchableMessageIds(messages);
  const currentRow = listed.find((row) => row.threadId === threadId);
  return (
    <SpaceRpcProvider spaceId="fixture" client={rpc}>
      <main className="mx-auto flex h-dvh max-w-6xl flex-col bg-background p-4 text-foreground">
        <header className="mb-3 flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className="shrink-0">Existing Mico</span>
          <MicoTaskTabs
            key={threadId ?? "main"}
            botId={botId}
            scope={scope}
            taskThreadId={threadId}
            rpc={rpc}
            onSelect={(target) => select(target)}
          />
        </header>
        <p className="sr-only" data-testid="active-conversation">
          {current}
        </p>
        <p className="sr-only" data-testid="jump-target">
          {jump}
        </p>
        <section
          className="flex-1 overflow-auto rounded-xl border px-4 py-3"
          data-testid="fixture-transcript"
        >
          {messages.map((message) => {
            const origin = branchOriginBlock(message);
            if (origin) {
              const source = branchSource(origin, listed, currentRow);
              return (
                <BranchOriginDivider
                  key={message.id}
                  messageId={message.id}
                  source={source}
                  onOpen={
                    source.kind === "deleted"
                      ? undefined
                      : () => {
                          setJump(`${origin.main ? "main" : origin.threadId}#${origin.messageId}`);
                          select(origin.main ? undefined : origin.threadId);
                        }
                  }
                />
              );
            }
            const text = message.blocks
              .map((block) => (block.kind === "text" ? block.text : ""))
              .join("");
            return (
              <div
                key={message.id}
                data-message-id={message.id}
                className={`group/message relative my-2 w-fit max-w-[70%] ${message.role === "user" ? "ms-auto" : ""}`}
              >
                <div
                  className={`rounded-2xl px-3.5 py-2 text-sm ${message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                >
                  {text}
                </div>
                {message.role === "bot" ? (
                  <MessageHoverActions
                    message={message}
                    side="end"
                    onReply={() => undefined}
                    onMarkUnread={() => undefined}
                    onReact={async () => undefined}
                    branchDisabled={running}
                    onBranch={
                      branchable.has(message.id)
                        ? async (target) => {
                            const branch = await branchConversation({
                              rpc,
                              scope,
                              botId,
                              source: threadId,
                              messageId: target.id,
                            });
                            select(branch.threadId);
                          }
                        : undefined
                    }
                  />
                ) : null}
              </div>
            );
          })}
        </section>
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setRunning((value) => !value)}>
            {running ? "Finish the turn" : "Start a turn"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const row = rows.find((item) => item.threadId === "trip");
              if (row) row.deleteAfter = new Date().toISOString();
            }}
          >
            Delete the budget
          </Button>
        </div>
        <Toaster />
      </main>
    </SpaceRpcProvider>
  );
}
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <Preview />
  </I18nProvider>,
);

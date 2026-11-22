// @vitest-environment jsdom
import type { ThreadMessage } from "@mycellios/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ResponseStyle } from "../../lib/response-style";
import { ResponseStyleContext } from "../../lib/response-style";
import { MessageView } from "./message-view";

vi.mock("../../lib/rpc", () => ({
  rpc: { artifacts: { get: () => new Promise(() => undefined) } },
}));

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  Plural: ({ value, one, other }: { value: number; one: string; other: string }) =>
    (value === 1 ? one : other).replace("#", String(value)),
  useLingui: () => ({
    i18n: { locale: "en" },
    t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
  }),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

type PeerBot = ComponentProps<typeof MessageView>["peerBot"];
const missingBot: PeerBot = () => undefined;
const existingBot: PeerBot = () => ({ color: "orange" });

const planner = (status: "created" | "archived" | "deleted" = "created") => ({
  kind: "child_bot" as const,
  botId: "child",
  name: "Planner",
  status,
});

function renderMessage(
  blocks: ThreadMessage["blocks"],
  peerBot: PeerBot,
  mentions?: ReturnType<typeof planner>[],
  options: { id?: string; showFullText?: boolean; textWasStreamed?: boolean; role?: ThreadMessage["role"]; style?: ResponseStyle; showToolActivity?: boolean; progress?: boolean; runEnded?: boolean; onBranch?: (message: ThreadMessage) => void; branchDisabled?: boolean } = {},
) {
  const onShowBot = vi.fn();
  const message: ThreadMessage = {
    id: options.id ?? "message",
    threadId: "thread",
    seq: 1,
    role: options.role ?? "bot",
    createdAt: new Date().toISOString(),
    ...(options.progress ? { progress: true as const } : {}),
    blocks,
  };
  act(() =>
    root.render(<ResponseStyleContext.Provider value={options.style ?? "classic"}>
      <MessageView
        artifactTarget={{ botId: "parent" }}
        canAnswer={false}
        canDismiss={false}
        message={message}
        mentions={mentions}
        onAnswer={vi.fn()}
        onShowBot={onShowBot}
        onOpenPeerMessages={vi.fn()}
        onTogglePeerReplies={vi.fn()}
        peerBot={peerBot}
        onRefresh={vi.fn()}
        onBotChanged={vi.fn()}
        onAddRoutine={vi.fn()}
        voiceReady={false}
        speaking={false}
        onSpeak={vi.fn()}
        onOpenComputer={vi.fn()}
        showToolActivity={options.showToolActivity ?? false}
        runEnded={options.runEnded}
        showFullText={options.showFullText}
        textWasStreamed={options.textWasStreamed}
        onReply={vi.fn()}
        onMarkUnread={vi.fn()}
        onReact={vi.fn()}
        onBranch={options.onBranch}
        branchDisabled={options.branchDisabled}
      /></ResponseStyleContext.Provider>,
    ),
  );
  const mention = container.querySelector<HTMLElement>('[data-testid="bot-mention"]')!;
  if (mention) act(() => mention.click());
  return { mention, onShowBot };
}

it("names a new bot inline in the reply, in its color", () => {
  const { mention, onShowBot } = renderMessage(
    [{ kind: "text", text: "Planner is ready." }],
    existingBot,
    [planner()],
  );
  const bubble = container.querySelector('[data-testid="message-bot-bubble"]');
  expect(bubble?.contains(mention)).toBe(true);
  expect(bubble?.textContent).toBe("Planner is ready.");
  expect(mention.tagName).toBe("BUTTON");
  expect(mention.querySelector("span[dir]")?.getAttribute("style")).toContain("color");
  expect(onShowBot).toHaveBeenCalledWith("child");
});

it("puts the bot first when the reply does not name it", () => {
  renderMessage([{ kind: "text", text: "Ready when you are." }], existingBot, [planner()]);
  expect(container.querySelector('[data-testid="message-bot-bubble"]')?.textContent).toBe(
    "Planner Ready when you are.",
  );
});

it.each([
  ["no longer exists", "created", missingBot],
  ["was deleted", "deleted", existingBot],
] as const)("keeps the name without color or link when the bot %s", (_, status, peerBot) => {
  const { mention, onShowBot } = renderMessage(
    [{ kind: "text", text: "Planner is gone." }],
    peerBot,
    [planner(status)],
  );
  expect(mention.textContent).toBe("Planner");
  expect(mention.tagName).toBe("SPAN");
  expect(mention.querySelector("span[dir]")?.getAttribute("style")).toBeNull();
  expect(onShowBot).not.toHaveBeenCalled();
});

it("shows an announcement with no reply yet on its own", () => {
  const { mention, onShowBot } = renderMessage([planner()], existingBot);
  expect(mention.textContent).toBe("Planner");
  expect(onShowBot).toHaveBeenCalledWith("child");
});

it("names the bot once across a reply's text blocks", () => {
  renderMessage(
    [
      { kind: "text", text: "Setting up." },
      { kind: "text", text: "Planner is ready." },
    ],
    existingBot,
    [planner()],
  );
  expect(container.querySelectorAll('[data-testid="bot-mention"]')).toHaveLength(1);
  expect(container.textContent).toContain("Setting up.");
  expect(container.textContent).toContain("Planner is ready.");
});

it("folds a long plain assistant answer and expands it without losing its ending", () => {
  const text = "A useful complete paragraph. ".repeat(1000) + "Final finding.";
  renderMessage([{ kind: "text", text }], missingBot);
  const more = [...container.querySelectorAll("button")].find(button => button.textContent === "Show full message")!;
  expect(more.getAttribute("aria-expanded")).toBe("false");
  expect(container.textContent).not.toContain("Final finding.");
  act(() => more.click());
  expect(more.getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).toContain("Final finding.");
  expect(more.textContent).toBe("Show less");
});

it("does not fold or hold back a long answer while it is streaming", () => {
  const text = "Streaming words. ".repeat(1500);
  renderMessage([{ kind: "progress", text }], missingBot, undefined, { id: "progress:run" });
  expect(container.textContent).toContain(text.trim());
  expect(container.textContent).not.toContain("Show full message");
});

it("reveals the full answer for a search or quote jump", () => {
  renderMessage([{ kind: "text", text: "Searchable answer. ".repeat(1500) }], missingBot, undefined, { showFullText: true });
  expect(container.textContent).not.toContain("Show full message");
});

it("keeps a streamed reply expanded after completion and lets the reader fold it", () => {
  renderMessage([{ kind: "text", text: "Watched while streaming. ".repeat(1000) }], missingBot, undefined, { textWasStreamed: true });
  const less = [...container.querySelectorAll("button")].find(button => button.textContent === "Show less")!;
  expect(less.getAttribute("aria-expanded")).toBe("true");
  act(() => less.click());
  expect(less.textContent).toBe("Show full message");
});

const step = (label: string) => ({ kind: "steps" as const, steps: [{ label, count: 1 }], durationMs: 1000 });

it("draws a natural turn as short notes, one steps summary and the answer", () => {
  renderMessage([
    { kind: "text", text: "Checking the deploy logs." },
    step("Read logs"),
    { kind: "text", text: "Checking the deploy logs." },
    { kind: "text", text: "." },
    step("Ran build"),
    { kind: "text", text: "The image build fails; I need the registry token." },
  ], missingBot, undefined, { style: "natural", showToolActivity: true });
  const notes = [...container.querySelectorAll('[data-testid="message-progress-note"]')].map(note => note.textContent);
  expect(notes).toEqual(["Checking the deploy logs."]);
  expect(container.querySelectorAll('[data-testid="tool-activity-line"]')).toHaveLength(1);
  expect(container.querySelector('[data-testid="message-bot-bubble"]')?.textContent)
    .toBe("The image build fails; I need the registry token.");
});

it("holds a natural answer until the turn is complete", () => {
  renderMessage([
    { kind: "text", text: "Looking at the logs." },
    step("Read logs"),
    { kind: "progress", text: "The build fai" },
  ], missingBot, undefined, { id: "progress:run", style: "natural" });
  expect(container.textContent).toContain("Looking at the logs.");
  expect(container.textContent).not.toContain("The build fai");
  expect(container.querySelector('[data-testid="message-bot-bubble"]')).toBeNull();
});

it("answers a finished natural turn with its latest note when nothing follows the last step", () => {
  renderMessage([
    { kind: "text", text: "Reading the config." },
    { kind: "text", text: "The config is valid." },
    step("Read config"),
  ], missingBot, undefined, { style: "natural" });
  expect(container.querySelector('[data-testid="message-bot-bubble"]')?.textContent).toBe("The config is valid.");
  expect([...container.querySelectorAll('[data-testid="message-progress-note"]')].map(note => note.textContent))
    .toEqual(["Reading the config."]);
});

it("folds a finished turn's task list and counts a running step as pending", () => {
  renderMessage([
    { kind: "plan", explanation: "Fix the deploy", steps: [
      { title: "Read logs", status: "done" },
      { title: "Fix build", status: "done" },
      { title: "Redeploy", status: "running" },
    ] },
    { kind: "text", text: "Deploy fixed." },
  ], missingBot, undefined, { style: "natural" });
  const plan = container.querySelector('[data-testid="plan"]');
  expect(plan?.textContent).toContain("Fix the deploy");
  expect(plan?.textContent).toContain("2 of 3 tasks done");
  expect(plan?.querySelector('[data-status="pending"]')?.textContent).toBe("Redeploy");
  expect(container.querySelector('[data-testid="message-bot-bubble"]')?.textContent).toBe("Deploy fixed.");
});

it("draws a durable progress message as a note without actions in the natural style", () => {
  renderMessage([{ kind: "text", text: "Still checking the build." }], missingBot, undefined, { style: "natural", progress: true });
  expect([...container.querySelectorAll('[data-testid="message-progress-note"]')].map(note => note.textContent))
    .toEqual(["Still checking the build."]);
  expect(container.querySelector('[data-testid="message-bot-bubble"]')).toBeNull();
  expect(container.querySelector('[data-testid="message-hover-actions"]')).toBeNull();
});

it("folds a finished natural answer even when it was watched while streaming", () => {
  renderMessage([{ kind: "text", text: "Long report line.\n".repeat(2000) }], missingBot, undefined, { style: "natural", textWasStreamed: true });
  const more = [...container.querySelectorAll("button")].find(button => button.textContent === "Show full message");
  expect(more?.getAttribute("aria-expanded")).toBe("false");
});

it("keeps an exact short answer exact without appending headings or tool activity", () => {
  renderMessage([{ kind: "text", text: "Listo" }], missingBot);
  expect(container.querySelector('[data-testid="message-bot-bubble"]')?.textContent).toBe("Listo");
  expect(container.querySelector('[data-testid="tool-activity"]')).toBeNull();
});

it("draws a generated image as one card instead of also showing its plain attachment", () => {
  renderMessage(
    [
      {
        kind: "image_generation",
        status: "completed",
        aspectRatio: "square",
        prompt: "a fox",
        artifactId: "artifact",
      },
      { kind: "image", artifactId: "artifact", mimeType: "image/png", name: "fox.png" },
    ],
    missingBot,
  );
  expect(container.querySelectorAll(".rk-image-gen")).toHaveLength(1);
  expect(container.textContent).toContain("a fox");
  expect(container.textContent).not.toContain("fox.png");
});

it("shows a card still marked generating as stopped once its run has ended", () => {
  const blocks: ThreadMessage["blocks"] = [
    { kind: "image_generation", status: "generating", aspectRatio: "square", prompt: "a fox" },
  ];
  renderMessage(blocks, missingBot);
  expect(container.querySelector(".rk-image-gen")?.getAttribute("data-status")).toBe(
    "generating",
  );
  renderMessage(blocks, missingBot, undefined, { runEnded: true });
  expect(container.querySelector(".rk-image-gen")?.getAttribute("data-status")).toBe(
    "interrupted",
  );
});

function renderInRouter(message: ThreadMessage) {
  act(() =>
    root.render(
      <MemoryRouter>
        <ResponseStyleContext.Provider value="classic">
          <MessageView
            artifactTarget={{ botId: "mico" }}
            canAnswer={false}
            canDismiss={false}
            message={message}
            onAnswer={vi.fn()}
            onShowBot={vi.fn()}
            onOpenPeerMessages={vi.fn()}
            onTogglePeerReplies={vi.fn()}
            peerBot={existingBot}
            onRefresh={vi.fn()}
            onBotChanged={vi.fn()}
            onAddRoutine={vi.fn()}
            voiceReady={false}
            speaking={false}
            onSpeak={vi.fn()}
            onOpenComputer={vi.fn()}
            showToolActivity={false}
            onReply={vi.fn()}
            onMarkUnread={vi.fn()}
            onReact={vi.fn()}
          />
        </ResponseStyleContext.Provider>
      </MemoryRouter>,
    ),
  );
}

it("folds a task report in the main chat behind an update marker that opens its conversation", () => {
  renderInRouter({
    id: "report",
    threadId: "main",
    seq: 4,
    role: "user",
    createdAt: new Date().toISOString(),
    blocks: [
      {
        kind: "task_report",
        fromBotId: "mico",
        fromBotName: "Mico",
        taskId: "task-1",
        title: "Forum thread",
        outcome: "completed",
        text: "The draft is ready.",
      },
    ],
  });
  const toggle = container.querySelector<HTMLButtonElement>('[data-testid="task-report-toggle"]')!;
  expect(toggle.textContent).toContain("Update from Mico");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(container.textContent).not.toContain("The draft is ready.");
  expect(container.querySelector('[data-testid="message-user-bubble"]')).toBeNull();
  act(() => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector('[data-testid="task-report-body"]')?.textContent).toContain("The draft is ready.");
  expect(container.querySelector('[data-testid="task-report-body"]')?.textContent).toContain("Forum thread");
  expect(container.querySelector('[data-testid="task-report-open"]')?.getAttribute("href")).toBe("/app/mico?task=task-1");
  act(() => toggle.click());
  expect(container.querySelector('[data-testid="task-report-body"]')).toBeNull();
});

it("shows a routine run marker as a compact line linking to the routine conversation", () => {
  renderInRouter({
    id: "marker",
    threadId: "main",
    seq: 5,
    role: "system",
    createdAt: new Date().toISOString(),
    blocks: [
      {
        kind: "routine_run",
        fromBotId: "mico",
        routineId: "routine-1",
        routineName: "Inbox check",
        taskId: "routine-thread-1",
        runId: "run-1",
        status: "quiet",
      },
    ],
  });
  const line = container.querySelector('[data-testid="routine-run-marker"]');
  expect(line?.textContent).toContain("Inbox check ran, nothing new");
  expect(container.querySelector('[data-testid="routine-run-open"]')?.getAttribute("href")).toBe(
    "/app/mico?task=routine-thread-1",
  );
});

it("shows a Mico's brief on its side of the task conversation", () => {
  renderInRouter({
    id: "brief",
    threadId: "task-1",
    seq: 0,
    role: "user",
    createdAt: new Date().toISOString(),
    blocks: [{ kind: "task_brief", fromBotId: "mico", fromBotName: "Mico", text: "Draft the forum thread" }],
  });
  const brief = container.querySelector('[data-testid="task-brief"]');
  expect(brief?.textContent).toContain("From Mico");
  expect(brief?.textContent).toContain("Draft the forum thread");
  expect(container.querySelector('[data-testid="message-user-bubble"]')).toBeNull();
  expect(brief?.parentElement?.className).not.toContain("items-end");
});

const menuItem = (text: string) =>
  Array.from(document.querySelectorAll<HTMLElement>("[role=\"menuitem\"]")).find((item) => item.textContent === text);
const openMore = () => act(() => container.querySelector<HTMLButtonElement>("button[aria-label=\"More\"]")!.click());

it("offers Branch in new conversation in the message menu only where the transcript allows it", () => {
  const onBranch = vi.fn();
  renderMessage([{ kind: "text", text: "Two hotels near the station." }], existingBot, undefined, { id: "answer", onBranch });
  openMore();
  const item = menuItem("Branch in new conversation");
  expect(item).toBeDefined();
  act(() => item!.click());
  expect(onBranch).toHaveBeenCalledTimes(1);
  expect(onBranch.mock.calls[0]![0]).toMatchObject({ id: "answer", role: "bot" });
  act(() => root.render(<span />));
  renderMessage([{ kind: "text", text: "An earlier note." }], existingBot, undefined, { id: "note" });
  openMore();
  expect(menuItem("Copy")).toBeDefined();
  expect(menuItem("Branch in new conversation")).toBeUndefined();
});

it("keeps Branch in new conversation visible but disabled while a turn runs", () => {
  const onBranch = vi.fn();
  renderMessage([{ kind: "text", text: "Two hotels near the station." }], existingBot, undefined, { onBranch, branchDisabled: true });
  openMore();
  const item = menuItem("Branch in new conversation")!;
  expect(item.getAttribute("aria-disabled") ?? item.getAttribute("data-disabled")).not.toBeNull();
  expect(item.getAttribute("title")).toBe("Wait until the current turn ends to branch this conversation.");
  act(() => item.click());
  expect(onBranch).not.toHaveBeenCalled();
});

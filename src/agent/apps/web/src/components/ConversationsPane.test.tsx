// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({ t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values) }),
}));
vi.mock("@lingui/core/macro", () => ({ t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values) }));
import { ConversationsPane, waitingConversations } from "./ConversationsPane";
import { closeBeside, NO_BESIDE, openBeside } from "../lib/conversation-pane";
import { NEW_CONVERSATION_TAB, type ConversationRow } from "../lib/thread-tabs";

const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => { for (const root of roots.splice(0)) await act(() => root.unmount()); document.body.innerHTML = ""; });

const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const rows: ConversationRow[] = [
  { threadId: "plan", title: "Plan the trip", state: "running", updatedAt: at(2) },
  { threadId: "asks", title: "Choose a supplier", state: "waiting", updatedAt: at(5) },
  { threadId: "screen", title: "Fill the form", state: "waiting", updatedAt: at(9) },
  { threadId: "done", title: "Old report", state: "idle", unread: true, updatedAt: at(30) },
  { threadId: "gone", title: "Archived", archived: true, state: "closed", updatedAt: at(1) },
];

function render(props: Partial<Parameters<typeof ConversationsPane>[0]> = {}) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  const handlers = {
    onOpen: vi.fn(), onNewConversation: vi.fn(), onShow: vi.fn(), onToggleBeside: vi.fn(), onCloseBeside: vi.fn(), onClose: vi.fn(),
  };
  const draw = (extra: Partial<Parameters<typeof ConversationsPane>[0]> = {}) => act(() => root.render(<ConversationsPane botName="Mico"
    rows={rows} draftOpen={false} beside={NO_BESIDE} canBeside {...handlers}
    renderConversation={row => <p data-testid="split">{row.title}</p>} {...props} {...extra} />));
  return { host, handlers, draw };
}
const buttonByText = (host: ParentNode, text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes(text))!;

describe("Conversations pane", () => {
  it("lists the open conversations by activity with their state, time and a waiting badge", async () => {
    const { host, draw } = render();
    await draw();
    const listed = Array.from(host.querySelectorAll("[data-conversation-row]")).map(row => row.getAttribute("data-conversation-row"));
    expect(listed).toEqual(["plan", "asks", "screen", "done"]);
    expect(host.querySelector('[data-conversation-row="done"] [data-thread-status]')?.getAttribute("data-thread-status")).toBe("unread");
    expect(host.querySelectorAll("time[data-thread-time]")).toHaveLength(4);
    expect(host.querySelector('[data-testid="conversations-waiting"]')?.textContent).toBe("Waiting for you: 2");
    expect(waitingConversations(rows)).toBe(2);
  });

  it("opens a conversation in the chat, or beside it with its toggle, and lists the draft", async () => {
    const { host, handlers, draw } = render();
    await draw({ draftOpen: true, currentId: "plan" });
    await act(() => buttonByText(host, "Choose a supplier").click());
    expect(handlers.onOpen).toHaveBeenCalledWith("asks");
    await act(() => host.querySelector<HTMLButtonElement>('[data-conversation-row="asks"] button[aria-label="Open beside the chat"]')!.click());
    expect(handlers.onToggleBeside).toHaveBeenCalledWith("asks");
    // The conversation already in the chat cannot also open beside it.
    expect(host.querySelector<HTMLButtonElement>('[data-conversation-row="plan"] button[aria-pressed]')!.disabled).toBe(true);
    await act(() => host.querySelector<HTMLButtonElement>(`[data-conversation-row="${NEW_CONVERSATION_TAB}"]`)!.click());
    expect(handlers.onOpen).toHaveBeenLastCalledWith(NEW_CONVERSATION_TAB);
  });

  it("offers New conversation when the Mico has none", async () => {
    const { host, handlers, draw } = render({ rows: [rows[4]!] });
    await draw();
    expect(host.querySelector('[data-testid="conversations-empty"]')?.textContent).toContain("No conversations yet");
    await act(() => buttonByText(host, "New conversation").click());
    expect(handlers.onNewConversation).toHaveBeenCalled();
  });

  it("shows a conversation beside the chat as a tab whose menu opens it in the chat or closes it", async () => {
    const beside = openBeside(openBeside(NO_BESIDE, "asks"), "done");
    const { host, handlers, draw } = render({ beside });
    await draw();
    expect(host.querySelector('[data-testid="split"]')?.textContent).toBe("Old report");
    const tabs = Array.from(host.querySelectorAll('[role="tab"]')).map(tab => tab.textContent);
    expect(tabs).toEqual(["Conversations2Waiting for you: 2", "Choose a supplier", "Old report"]);
    expect(host.querySelector('[data-testid="conversations-waiting"]')?.getAttribute("title")).toBe("Waiting for you: 2");
    await act(() => buttonByText(host, "Choose a supplier").click());
    expect(handlers.onShow).toHaveBeenCalledWith("asks");
    await act(() => host.querySelector<HTMLButtonElement>('[aria-label="Actions for Old report"]')!.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    expect(items.map(item => item.textContent)).toEqual(["Open in the chat", "Close"]);
    await act(() => items[1]!.click());
    expect(handlers.onCloseBeside).toHaveBeenCalledWith("done");
    // Closing it shows its neighbour; the list returns once none is left.
    expect(closeBeside(beside, "done").active).toBe("asks");
  });

  it("hides the beside toggle where there is no room for it", async () => {
    const { host, draw } = render({ canBeside: false });
    await draw();
    expect(host.querySelector('button[aria-label="Open beside the chat"]')).toBeNull();
  });
});

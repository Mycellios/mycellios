// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RpcClient } from "../lib/rpc";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock("@mycellios/ui-web", async (original) => ({ ...await original<typeof import("@mycellios/ui-web")>(), toast }));
import { fitConversationTabs, MainTabMenu, MicoTaskTabs } from "./MicoTaskTabs";
import { queryClient } from "../lib/query";
import { NEW_CONVERSATION_TAB, readConversationTabs, updateConversationTabs } from "../lib/thread-tabs";
import { openBranchTab } from "../lib/conversation-branch";

const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => { localStorage.clear(); queryClient.clear(); toast.mockClear(); toast.error.mockClear(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(async () => { for (const root of roots.splice(0)) await act(() => root.unmount()); document.body.innerHTML = ""; });

function mount() {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  return { host, root };
}
const button = (label: string, within: ParentNode = document) => within.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const picker = () => document.querySelector('[data-slot="popover-content"]')!;
const menuItem = (text: string) => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(item => item.textContent === text)!;
async function openMenu(target: Element) {
  await act(() => target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 })));
}
const key = (target: EventTarget, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
const tabButton = (host: ParentNode, id: string) => host.querySelector<HTMLButtonElement>(`[data-thread-tab="${id}"] button:not([aria-label])`)!;
const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 0)));

describe("Mico task navigation", () => {
  it("preloads two picker destinations even when only the active tab fits", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); roots.push(root);
    const tabs = ["active", "first", "second", "third"].map(threadId => ({ threadId, title: threadId }));
    const rpc = { development: { list: vi.fn().mockResolvedValue(tabs) } } as unknown as RpcClient;
    // Leave the first read pending: the second must start independently.
    const warm = vi.fn(() => new Promise<unknown>(() => {}));
    const select = vi.fn();
    await act(() => root.render(<MicoTaskTabs botId="mico" scope="narrow" taskThreadId="active"
      rpc={rpc} onSelect={select} onWarm={warm} />));
    expect(host.querySelector('button[title="active"]')).not.toBeNull();
    expect(host.querySelector('button[title="first"]')).toBeNull();
    expect(warm.mock.calls).toEqual([["mico", "first"], ["mico", "second"]]);
    expect(select).not.toHaveBeenCalled();
  });

  it("warms the mobile picker and starts an untouched destination on pointer down without delaying selection", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); roots.push(root);
    const tabs = ["active", "first", "second", "third"].map(threadId => ({ threadId, title: threadId }));
    const rpc = { development: { list: vi.fn().mockResolvedValue(tabs) } } as unknown as RpcClient;
    const warm = vi.fn().mockRejectedValue(new Error("offline"));
    const select = vi.fn();
    await act(() => root.render(<MicoTaskTabs botId="mico" scope="menu" taskThreadId="active"
      rpc={rpc} onSelect={select} onWarm={warm} inMenu />));
    expect(warm).not.toHaveBeenCalled();
    await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Conversations"]')!.click());
    expect(warm).toHaveBeenCalledWith("mico", "first");
    expect(warm).toHaveBeenCalledWith("mico", "second");
    const third = [...document.querySelectorAll("button")].find(button => button.textContent === "third")!;
    await act(() => third.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(warm).toHaveBeenLastCalledWith("mico", "third");
    expect(select).not.toHaveBeenCalled();
    await act(() => third.click());
    expect(select).toHaveBeenCalledWith("third");
  });

  it("opens a draft tab with + and creates nothing until the first message", async () => {
    const { host, root } = mount();
    const select = vi.fn(), open = vi.fn();
    const rpc = { development: { list: vi.fn().mockResolvedValue([]), open } } as unknown as RpcClient;
    await act(() => root.render(<MicoTaskTabs botId="infra" scope="infra" rpc={rpc} onSelect={select} />));
    expect(host.textContent).not.toContain("General");
    expect(button("New conversation", host).textContent).toBe("");
    await act(() => button("New conversation", host).click());
    expect(open).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledWith(NEW_CONVERSATION_TAB);
    expect(readConversationTabs("infra").ids).toEqual([NEW_CONVERSATION_TAB]);
    await act(() => root.render(<MicoTaskTabs botId="infra" scope="infra" rpc={rpc} onSelect={select} newConversationOpen />));
    const draft = tabButton(host, NEW_CONVERSATION_TAB);
    expect(draft.textContent).toBe("New conversation");
    expect(draft.getAttribute("aria-current")).toBe("page");
    expect(readConversationTabs("infra").active).toBe(NEW_CONVERSATION_TAB);
    // Closing the draft returns to the main chat.
    await act(() => button("Close tab", host).click());
    expect(select).toHaveBeenLastCalledWith(undefined);
  });

  it("shows only + while the Mico has no conversations, and the picker once it has one", async () => {
    const { host, root } = mount();
    const list = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([{ threadId: "a", title: "Plan" }]);
    const rpc = { development: { list } } as unknown as RpcClient;
    await act(() => root.render(<MicoTaskTabs botId="mico" scope="empty" rpc={rpc} onSelect={vi.fn()} />));
    expect(button("All conversations", host)).toBeNull();
    expect(button("New conversation", host)).not.toBeNull();
    await act(() => root.render(<MicoTaskTabs botId="mico" scope="empty" rpc={rpc} onSelect={vi.fn()} messageCount={1} />));
    expect(button("All conversations", host)).not.toBeNull();
  });

  it("offers New conversation first in the phone menu even without any history", async () => {
    const { host, root } = mount();
    const select = vi.fn(), open = vi.fn();
    const rpc = { development: { list: vi.fn().mockResolvedValue([]), open } } as unknown as RpcClient;
    await act(() => root.render(<MicoTaskTabs botId="mico" scope="picker" rpc={rpc} onSelect={select} inMenu />));
    await act(() => button("Conversations", host).click());
    const first = picker().querySelector<HTMLButtonElement>("button")!;
    expect(first.textContent).toBe("New conversation");
    await act(() => first.click());
    expect(open).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledWith(NEW_CONVERSATION_TAB);
  });

  it("marks each non-ordinary thread's kind, lists archived conversations last and restores one when chosen", async () => {
    const { host, root } = mount();
    const select = vi.fn();
    let oldArchived = true;
    const list = vi.fn(async () => [
      { threadId: "old", title: "Old budget", kind: "conversation", archived: oldArchived },
      { threadId: "plan", title: "Plan", kind: "conversation", archived: false },
      { threadId: "daily", title: "Daily digest", kind: "routine", archived: false },
      { threadId: "flow", title: "Publish step", kind: "workflow", archived: false },
      { threadId: "help", title: "Check prices", kind: "delegation", archived: false },
      { threadId: "legacy", title: "Legacy" },
      { threadId: "started", title: "Compare offers", kind: "other", startedBy: "agent" },
      { threadId: "night", title: "Nightly report", kind: "routine", archived: true },
    ]);
    const restore = vi.fn(async () => { oldArchived = false; return { ok: true, restored: "archive" }; });
    const rpc = { development: { list, restore } } as unknown as RpcClient;
    await act(() => root.render(<MicoTaskTabs botId="mico" scope="kinds" rpc={rpc} onSelect={select} />));
    await act(() => button("All conversations", host).click());
    const rows = Array.from(picker().querySelectorAll<HTMLButtonElement>("button:not([aria-label])")).map(item => item.textContent);
    expect(rows).toEqual(["New conversation", "Main chat", "Plan", "Daily digestRoutine", "Publish stepWorkflow",
      "Check pricesDelegated", "Legacy", "Compare offers", "Old budget", "Nightly reportRoutine"]);
    const archived = picker().querySelector("fieldset")!;
    expect(archived.querySelector("legend")!.textContent).toBe("Archived");
    // Conversations the person or their Mico started take a title; routine and delegated threads do not.
    const renames = Array.from(picker().querySelectorAll('button[aria-label="Rename conversation"]'))
      .map(item => item.parentElement!.querySelector("span[dir]")!.textContent);
    expect(renames).toEqual(["Plan", "Legacy", "Compare offers", "Old budget"]);
    const reopen = Array.from(archived.querySelectorAll<HTMLButtonElement>("button:not([aria-label])")).find(item => item.textContent === "Old budget")!;
    await act(() => reopen.click());
    expect(restore).toHaveBeenCalledWith({ botId: "mico", taskThreadId: "old" });
    expect(select).toHaveBeenLastCalledWith("old");
    expect(readConversationTabs("kinds").ids).toContain("old");
  });

  it("shows status marks on tabs and picker rows, newest activity first, with a dot for hidden replies", async () => {
    const { host, root } = mount();
    updateConversationTabs("marks", state => ({ ...state, ids: ["run", "wait"] }));
    queryClient.setQueryData(["conversation-tabs", "marks", "width"], 740);
    const list = vi.fn().mockResolvedValue([
      { threadId: "run", title: "Working one", state: "running", updatedAt: "2026-11-20T10:00:00.000Z" },
      { threadId: "wait", title: "Asks you", state: "waiting", updatedAt: "2026-11-21T10:00:00.000Z" },
      { threadId: "line", title: "In line", state: "queued", updatedAt: "2026-11-19T10:00:00.000Z" },
      { threadId: "bad", title: "Broke", state: "idle", outcome: "failed", lastError: "Quota", updatedAt: "2026-11-18T10:00:00.000Z" },
      { threadId: "new", title: "Answered", state: "idle", unread: true, updatedAt: "2026-11-22T10:00:00.000Z" },
    ]);
    const rpc = { development: { list } } as unknown as RpcClient;
    await act(() => root.render(<MicoTaskTabs botId="mico" scope="marks" rpc={rpc} onSelect={vi.fn()} />));
    expect(host.querySelector('[data-thread-tab="run"] [data-thread-status]')!.getAttribute("data-thread-status")).toBe("working");
    expect(host.querySelector('[data-thread-tab="wait"] [data-thread-status]')!.getAttribute("data-thread-status")).toBe("waiting");
    const chevron = button("All conversations, new replies", host);
    expect(chevron.querySelector('[data-testid="conversations-new-replies"]')).not.toBeNull();
    await act(() => chevron.click());
    const rows = Array.from(picker().querySelectorAll("[data-thread-status]")).map(mark => mark.getAttribute("data-thread-status"));
    expect(rows).toEqual(["unread", "waiting", "working", "queued", "failed"]);
    expect(picker().querySelectorAll("time[data-thread-time]")).toHaveLength(5);
  });

  it("opens a conversation the Mico started as a background tab without taking focus", async () => {
    const { host, root } = mount();
    const select = vi.fn();
    const rows: Array<Record<string, unknown>> = [{ threadId: "mine", title: "Mine", startedBy: "user", createdAt: "2026-11-20T10:00:00.000Z" }];
    const list = vi.fn(async () => rows.map(row => ({ ...row })));
    const rpc = { development: { list } } as unknown as RpcClient;
    queryClient.setQueryData(["conversation-tabs", "background", "width"], 900);
    await act(() => root.render(<MicoTaskTabs botId="mico" scope="background" taskThreadId="mine" rpc={rpc} onSelect={select} />));
    rows.push({ threadId: "task", title: "Compare offers", startedBy: "agent", createdAt: "2026-11-21T10:00:00.000Z" });
    await act(() => root.render(<MicoTaskTabs botId="mico" scope="background" taskThreadId="mine" rpc={rpc} onSelect={select} messageCount={2} />));
    expect(readConversationTabs("background").ids).toEqual(["mine", "task"]);
    expect(tabButton(host, "task").textContent).toBe("Compare offers");
    expect(tabButton(host, "mine").getAttribute("aria-current")).toBe("page");
    expect(select).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(tabButton(host, "task"));
  });

  it("shows a branch right after the tab it came from, titled at once, as the person's own conversation", async () => {
    const { host, root } = mount();
    const select = vi.fn();
    const rows: Array<Record<string, unknown>> = [
      { threadId: "a", title: "Trip budget", kind: "conversation", startedBy: "user" },
      { threadId: "b", title: "Notes", kind: "conversation", startedBy: "user" },
    ];
    let release: () => void = () => undefined;
    const list = vi.fn(async () => rows.map(row => ({ ...row })));
    const rpc = { development: { list } } as unknown as RpcClient;
    updateConversationTabs("branches", state => ({ ...state, ids: ["a", "b"] }));
    queryClient.setQueryData(["conversation-tabs", "branches", "width"], 1200);
    await act(() => root.render(<MicoTaskTabs botId="mico" scope="branches" taskThreadId="a" rpc={rpc} onSelect={select} />));
    // The server answered with the new branch; until the list is read again its tab already has its title.
    list.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(rows.map(row => ({ ...row }))); }));
    await act(async () => openBranchTab("branches", "a", { threadId: "a2", title: "Trip budget #2" }));
    await act(() => root.render(<MicoTaskTabs botId="mico" scope="branches" taskThreadId="a2" rpc={rpc} onSelect={select} />));
    expect(readConversationTabs("branches").ids).toEqual(["a", "a2", "b"]);
    expect(tabButton(host, "a2").textContent).toBe("Trip budget #2");
    expect(tabButton(host, "a2").getAttribute("aria-current")).toBe("page");
    rows.splice(1, 0, { threadId: "a2", title: "Trip budget #2", kind: "conversation", startedBy: "branch", titleSource: "auto", branchedFromThreadId: "a" });
    await act(async () => release());
    await flush();
    expect(Array.from(host.querySelectorAll("[data-thread-tab]")).map(tab => tab.getAttribute("data-thread-tab"))).toEqual(["a", "a2", "b"]);
    // Like the person's own conversations it takes a title of theirs (F2) and carries no kind label.
    expect(tabButton(host, "a2").getAttribute("aria-keyshortcuts")).toContain("F2");
    expect(host.querySelector('[data-thread-tab="a2"] [data-thread-kind]')).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it("closes the view of a conversation archived elsewhere and brings its tab back on restore", async () => {
    const { host, root } = mount();
    const select = vi.fn();
    updateConversationTabs("elsewhere", state => ({ ...state, ids: ["a", "b"] }));
    queryClient.setQueryData(["conversation-tabs", "elsewhere", "width"], 900);
    let archived = false;
    const list = vi.fn(async () => [{ threadId: "a", title: "First" }, { threadId: "b", title: "Second", archived }]);
    const rpc = { development: { list } } as unknown as RpcClient;
    const render = (count: number) => root.render(<MicoTaskTabs botId="mico" scope="elsewhere" taskThreadId="b" rpc={rpc} onSelect={select} messageCount={count} />);
    await act(() => render(0));
    archived = true;
    await act(() => render(1));
    expect(select).toHaveBeenLastCalledWith("a");
    expect(readConversationTabs("elsewhere")).toMatchObject({ ids: ["a"], parked: [{ id: "b", index: 1 }] });
    archived = false;
    await act(() => root.render(<MicoTaskTabs botId="mico" scope="elsewhere" taskThreadId="a" rpc={rpc} onSelect={select} messageCount={2} />));
    expect(readConversationTabs("elsewhere").ids).toEqual(["a", "b"]);
    expect(tabButton(host, "b").textContent).toBe("Second");
  });

  it("refreshes the generated title after a message and saves a manual rename", async () => {
    const { host, root } = mount();
    let title = "";
    const list = vi.fn(async () => [{ threadId: "task", title }]);
    const rename = vi.fn(async (input: { title: string }) => { title = input.title; return { threadId: "task", title }; });
    const rpc = { development: { list, rename } } as unknown as RpcClient;
    const render = (count: number) => root.render(<MicoTaskTabs botId="mico" scope="rename" taskThreadId="task" messageCount={count} rpc={rpc} onSelect={vi.fn()} />);
    await act(() => render(0));
    expect(host.querySelector('button[title="New conversation"]')).not.toBeNull();
    title = "Preparar presupuesto";
    await act(() => render(1));
    expect(host.querySelector('button[title="Preparar presupuesto"]')).not.toBeNull();
    await act(() => button("All conversations", host).click());
    await act(() => button("Rename conversation").click());
    const input = document.querySelector<HTMLInputElement>("input")!;
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Presupuesto 2027");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
    await act(() => key(input, { key: "Enter" }));
    expect(rename).toHaveBeenCalledWith({ botId: "mico", taskThreadId: "task", title: "Presupuesto 2027" });
    expect(host.querySelector('button[title="Presupuesto 2027"]')).not.toBeNull();
  });

  it("closes the active tab without removing its conversation from the thread list", async () => {
    const { host, root } = mount();
    const select = vi.fn();
    const list = vi.fn().mockResolvedValue([{ threadId: "task-1", title: "Independent work" }]);
    const rpc = { development: { list } } as unknown as RpcClient;
    const render = (threadId?: string) => root.render(<MicoTaskTabs botId="mico" scope="test-mico"
      taskThreadId={threadId} rpc={rpc} onSelect={select} />);
    await act(async () => render("task-1"));
    expect(list).toHaveBeenCalledWith({ botId: "mico" });
    const task = host.querySelector<HTMLButtonElement>('button[aria-current="page"]')!;
    expect(task.textContent).toBe("Independent work");
    expect(host.querySelector("[data-main-chat-tab]")?.textContent).toBe("Main chat");
    await act(() => task.click());
    expect(host.querySelector('input[aria-label="Conversation title"]')).not.toBeNull();
    expect(select).not.toHaveBeenCalled();
    await act(() => button("Close tab", host).click());
    expect(select).toHaveBeenLastCalledWith(undefined);
    await act(() => render());
    expect(host.querySelector("[data-main-chat-tab]")?.getAttribute("aria-current")).toBe("page");
    expect(host.querySelector('button[title="Independent work"]')).toBeNull();
    await act(() => button("All conversations", host).click());
    const reopen = Array.from(document.querySelectorAll("button")).find(item => item.textContent === "Independent work")!;
    await act(() => reopen.click());
    expect(select).toHaveBeenLastCalledWith("task-1");
  });

  it("discards a previous Mico's late list response after changing scope", async () => {
    const { host, root } = mount();
    let finish!: (rows: { threadId: string; title: string }[]) => void;
    const list = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce([{ threadId: "b-task", title: "Mico B work" }]);
    const rpc = { development: { list } } as unknown as RpcClient;
    await act(() => root.render(<MicoTaskTabs key="a" scope="test-a" botId="a" rpc={rpc} onSelect={vi.fn()} />));
    await act(() => root.render(<MicoTaskTabs key="b" scope="test-b" botId="b" rpc={rpc} onSelect={vi.fn()} />));
    await act(() => finish([{ threadId: "a-task", title: "Stale Mico A work" }]));
    await act(() => button("All conversations", host).click());
    expect(document.body.textContent).toContain("Mico B work");
    expect(document.body.textContent).not.toContain("Stale Mico A work");
  });

  it("retains tab titles and open tabs during a scoped remount with a delayed network", async () => {
    const { host, root } = mount();
    let resolveList!: (rows: { threadId: string; title: string }[]) => void;
    const list = vi.fn().mockResolvedValueOnce([{ threadId: "a", title: "Existing title" }])
      .mockImplementation(() => new Promise(resolve => { resolveList = resolve; }));
    const rpc = { development: { list } } as unknown as RpcClient;
    const render = (key: string, taskThreadId: string) => root.render(<MicoTaskTabs key={key} botId="mico" scope="persist" taskThreadId={taskThreadId} rpc={rpc} onSelect={vi.fn()} />);
    await act(() => render("a", "a"));
    updateConversationTabs("persist", state => ({ ...state, ids: [...state.ids, "b"] }));
    await act(() => render("b", "b"));
    expect(JSON.parse(localStorage.getItem("mycellios:open-task-tabs:persist")!).ids).toEqual(["a", "b"]);
    // History is present before this new task's first list request resolves.
    await act(() => button("All conversations", host).click());
    expect(document.body.textContent).toContain("Existing title");
    await act(() => resolveList([{ threadId: "a", title: "Existing title" }, { threadId: "b", title: "" }]));
  });

  it("edits the selected title on click, cancels with Escape, and saves on blur", async () => {
    const { host, root } = mount();
    const rename = vi.fn().mockResolvedValue({ threadId: "a", title: "New name" });
    const rpc = { development: { list: vi.fn().mockResolvedValue([{ threadId: "a", title: "Original" }]), rename } } as unknown as RpcClient;
    await act(() => root.render(<MicoTaskTabs botId="mico" scope="inline" taskThreadId="a" rpc={rpc} onSelect={vi.fn()} />));
    await act(() => host.querySelector<HTMLButtonElement>('button[title="Original"]')!.click());
    let input = host.querySelector<HTMLInputElement>("input")!;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0); expect(input.selectionEnd).toBe(8);
    await act(() => key(input, { key: "Escape" }));
    expect(rename).not.toHaveBeenCalled(); expect(host.querySelector("input")).toBeNull();
    await act(() => host.querySelector<HTMLButtonElement>('button[title="Original"]')!.click());
    input = host.querySelector<HTMLInputElement>("input")!;
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "New name");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => input.blur());
    expect(rename).toHaveBeenCalledOnce();
    expect(rename).toHaveBeenCalledWith({ botId: "mico", taskThreadId: "a", title: "New name" });
  });

  it("keeps a failed edit for retry and prevents duplicate submissions", async () => {
    const { host, root } = mount();
    let finish!: (value: { threadId: string; title: string }) => void;
    const rename = vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const rpc = { development: { list: vi.fn().mockResolvedValue([{ threadId: "a", title: "Original" }]), rename } } as unknown as RpcClient;
    await act(() => root.render(<MicoTaskTabs botId="mico" scope="retry" taskThreadId="a" rpc={rpc} onSelect={vi.fn()} />));
    await act(() => host.querySelector<HTMLButtonElement>('button[title="Original"]')!.click());
    const input = host.querySelector<HTMLInputElement>("input")!;
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Retry title");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const enter = () => key(input, { key: "Enter" });
    await act(() => { enter(); });
    expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(input.value).toBe("Retry title");
    await act(() => { enter(); enter(); });
    expect(rename).toHaveBeenCalledTimes(2);
    await act(() => finish({ threadId: "a", title: "Retry title" }));
    expect(host.querySelector("input")).toBeNull();
  });
});

describe("tab keyboard, mouse and menu", () => {
  const rows = [{ threadId: "a", title: "Alpha", kind: "conversation", state: "idle" }, { threadId: "b", title: "Beta", kind: "conversation", state: "idle" },
    { threadId: "c", title: "Gamma", kind: "conversation", state: "running" }];
  async function setup(scope: string, active = "b", extra: Record<string, unknown> = {}) {
    const { host, root } = mount();
    updateConversationTabs(scope, state => ({ ...state, ids: ["a", "b", "c"] }));
    queryClient.setQueryData(["conversation-tabs", scope, "width"], 900);
    const select = vi.fn();
    const rpc = { development: {
      list: vi.fn().mockResolvedValue(rows),
      rename: vi.fn().mockResolvedValue({ threadId: "b", title: "Beta" }),
      archive: vi.fn().mockResolvedValue({ ok: true, archivedAt: "2026-11-22T10:00:00.000Z" }),
      remove: vi.fn().mockResolvedValue({ ok: true, deleteAfter: new Date(Date.now() + 6_000).toISOString() }),
      restore: vi.fn().mockResolvedValue({ ok: true, restored: "delete" }),
    } } as unknown as RpcClient;
    await act(() => root.render(<MicoTaskTabs botId="mico" scope={scope} taskThreadId={active} rpc={rpc} onSelect={select} {...extra} />));
    return { host, root, select, rpc: rpc as unknown as { development: Record<string, ReturnType<typeof vi.fn>> } };
  }

  it("closes with Delete, Backspace and a middle click, renames with F2 and double click, and moves with Alt+Shift+arrows", async () => {
    const { host, select } = await setup("keys");
    const pendingFrames: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => pendingFrames.push(callback));
    try {
      await act(() => {
        const tab = tabButton(host, "a");
        tab.focus();
        key(tab, { key: "ArrowRight", altKey: true, shiftKey: true });
      });
      expect(readConversationTabs("keys").ids).toEqual(["b", "a", "c"]);
      await act(() => {
        const tab = tabButton(host, "a");
        tab.focus();
        key(tab, { key: "ArrowLeft", altKey: true, shiftKey: true });
      });
      expect(readConversationTabs("keys").ids).toEqual(["a", "b", "c"]);
      await act(() => key(tabButton(host, "b"), { key: "F2" }));
    } finally {
      requestFrame.mockRestore();
    }
    // Reordering must leave the rename field focused even if its focus callbacks arrive late.
    await act(() => { for (const frame of pendingFrames) frame(performance.now()); });
    const titleInput = host.querySelector('input[aria-label="Conversation title"]');
    expect(titleInput).not.toBeNull();
    expect(document.activeElement).toBe(titleInput);
    await act(() => key(titleInput!, { key: "Escape" }));
    await act(() => tabButton(host, "c").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(host.querySelector('input[aria-label="Conversation title"]')).not.toBeNull();
    await act(() => key(host.querySelector("input")!, { key: "Escape" }));
    await act(() => tabButton(host, "c").dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 })));
    expect(readConversationTabs("keys").ids).toEqual(["a", "b"]);
    await act(() => key(tabButton(host, "b"), { key: "Delete" }));
    expect(readConversationTabs("keys").ids).toEqual(["a"]);
    expect(select).toHaveBeenLastCalledWith("a");
    await act(() => key(tabButton(host, "a"), { key: "Backspace" }));
    expect(readConversationTabs("keys").ids).toEqual([]);
  });

  it("starts a conversation with Ctrl+Shift+O and steps through tabs with Alt+Shift+Down/Up", async () => {
    const { select } = await setup("global");
    await act(() => key(window, { key: "O", code: "KeyO", ctrlKey: true, shiftKey: true }));
    expect(select).toHaveBeenLastCalledWith(NEW_CONVERSATION_TAB);
    await act(() => key(window, { key: "ArrowDown", altKey: true, shiftKey: true }));
    expect(select).toHaveBeenLastCalledWith("c");
    await act(() => key(window, { key: "ArrowUp", altKey: true, shiftKey: true }));
    expect(select).toHaveBeenLastCalledWith("a");
    // A text field that holds text keeps the keys for selecting text.
    const field = document.createElement("textarea"); field.value = "draft"; document.body.append(field);
    select.mockClear();
    await act(() => key(field, { key: "ArrowDown", altKey: true, shiftKey: true }));
    expect(select).not.toHaveBeenCalled();
  });

  it("reorders tabs by dragging", async () => {
    const { host } = await setup("drag");
    const store = new Map<string, string>();
    const dataTransfer = { setData: (type: string, value: string) => store.set(type, value), effectAllowed: "", dropEffect: "" };
    const drag = (type: string, id: string, clientX = 0) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX });
      Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      host.querySelector(`[data-thread-tab="${id}"]`)!.dispatchEvent(event);
    };
    await act(() => drag("dragstart", "a"));
    await act(() => drag("dragover", "c", 10_000));
    await act(() => drag("drop", "c", 10_000));
    expect(readConversationTabs("drag").ids).toEqual(["b", "c", "a"]);
  });

  it("offers close, rename, archive and delete in a tab's menu, closing only tabs for the close actions", async () => {
    const { host, select, rpc } = await setup("menu");
    await openMenu(host.querySelector('[data-thread-tab="a"]')!);
    expect(Array.from(document.querySelectorAll('[role="menuitem"]')).map(item => item.textContent))
      .toEqual(["Open", "Close tab", "Close other tabs", "Close tabs to the right", "Rename conversation", "Archive", "Delete"]);
    await act(() => menuItem("Close tabs to the right").click());
    expect(readConversationTabs("menu").ids).toEqual(["a"]);
    expect(select).toHaveBeenLastCalledWith("a");
    expect(rpc.development.archive).not.toHaveBeenCalled();
    expect(rpc.development.remove).not.toHaveBeenCalled();
  });

  it("archives from the tab menu, which stops it on the server, closes the tab and offers Undo", async () => {
    const changed = vi.fn();
    const { host, select, rpc } = await setup("archive", "b", { onConversationsChanged: changed });
    await openMenu(host.querySelector('[data-thread-tab="b"]')!);
    await act(() => menuItem("Archive").click());
    await flush();
    expect(rpc.development.archive).toHaveBeenCalledWith({ botId: "mico", taskThreadId: "b" });
    expect(readConversationTabs("archive").ids).toEqual(["a", "c"]);
    expect(select).toHaveBeenLastCalledWith("a");
    // The sidebar reads the Mico again, so a cancelled question leaves "Needs you".
    expect(changed).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledOnce();
    const [message, options] = toast.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    // Tests run the uncompiled macro, which drops a leading placeholder; the build keeps "{title} archived".
    expect(message).toMatch(/archived$/);
    expect(options.action.label).toBe("Undo");
    await act(async () => { options.action.onClick(); await Promise.resolve(); });
    await flush();
    expect(rpc.development.restore).toHaveBeenCalledWith({ botId: "mico", taskThreadId: "b" });
    expect(readConversationTabs("archive").ids).toContain("b");
    expect(select).toHaveBeenLastCalledWith("b");
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("deletes a conversation that only waits for an answer", async () => {
    const { host, root, rpc } = await setup("waiting-delete", "a");
    rpc.development.list!.mockResolvedValue(rows.map(row => row.threadId === "b" ? { ...row, state: "waiting" } : row));
    await act(() => root.render(<MicoTaskTabs botId="mico" scope="waiting-delete" taskThreadId="a" rpc={rpc as unknown as RpcClient} onSelect={vi.fn()} refreshKey="1" />));
    await flush();
    expect(host.querySelector('[data-thread-tab="b"] [data-thread-status]')!.getAttribute("data-thread-status")).toBe("waiting");
    await openMenu(host.querySelector('[data-thread-tab="b"]')!);
    expect(menuItem("Delete").hasAttribute("data-disabled")).toBe(false);
    await act(() => menuItem("Delete").click());
    await flush();
    expect(rpc.development.remove).toHaveBeenCalledWith({ botId: "mico", taskThreadId: "b" });
  });

  it("deletes at once with Undo that restores the tab at its place, and never while it works", async () => {
    const { host, select, rpc } = await setup("delete");
    await openMenu(host.querySelector('[data-thread-tab="c"]')!);
    expect(menuItem("Delete").hasAttribute("data-disabled")).toBe(true);
    await act(() => key(document.activeElement ?? document.body, { key: "Escape" }));
    await openMenu(host.querySelector('[data-thread-tab="b"]')!);
    await act(() => menuItem("Delete").click());
    await flush();
    expect(readConversationTabs("delete")).toMatchObject({ ids: ["a", "c"], parked: [{ id: "b", index: 1 }] });
    expect(select).toHaveBeenLastCalledWith("a");
    expect(rpc.development.remove).toHaveBeenCalledWith({ botId: "mico", taskThreadId: "b" });
    expect(toast).toHaveBeenCalledOnce();
    const [, options] = toast.mock.calls[0] as [string, { action: { label: string; onClick: () => void }; duration: number }];
    expect(options.action.label).toBe("Undo");
    expect(options.duration).toBeGreaterThan(4_000);
    await act(async () => { options.action.onClick(); await Promise.resolve(); });
    await flush();
    expect(rpc.development.restore).toHaveBeenCalledWith({ botId: "mico", taskThreadId: "b" });
    expect(readConversationTabs("delete").ids).toEqual(["a", "b", "c"]);
    expect(select).toHaveBeenLastCalledWith("b");
  });

  it("asks before deleting on a phone and offers no Undo", async () => {
    const { host, rpc } = await setup("phone", "a", { confirmDelete: true });
    await openMenu(host.querySelector('[data-thread-tab="b"]')!);
    await act(() => menuItem("Delete").click());
    expect(rpc.development.remove).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Delete this conversation?");
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-slot="alert-dialog-action"]')).find(item => item.textContent === "Delete")!;
    await act(() => confirm.click());
    await flush();
    expect(rpc.development.remove).toHaveBeenCalledWith({ botId: "mico", taskThreadId: "b" });
    expect(toast).not.toHaveBeenCalled();
  });

  it("gives the main tab only the close actions", async () => {
    const { host, root } = mount();
    const close = vi.fn();
    await act(() => root.render(<MainTabMenu enabled label="Main chat" onCloseAll={close}><button type="button">Mico</button></MainTabMenu>));
    await openMenu(host.querySelector("button")!);
    expect(Array.from(document.querySelectorAll('[role="menuitem"]')).map(item => item.textContent)).toEqual(["Close other tabs", "Close tabs to the right"]);
    await act(() => menuItem("Close other tabs").click());
    expect(close).toHaveBeenCalledOnce();
  });

  it("turns into a switcher with the current title below 440 px and into the picker button below 48 px", async () => {
    const compact = await setup("compact", "b");
    expect(compact.host.querySelector("nav")!.getAttribute("data-tabs-layout")).toBe("tabs");
    queryClient.setQueryData(["conversation-tabs", "narrow", "width"], 160);
    const { host, root } = mount();
    const rpc = { development: { list: vi.fn().mockResolvedValue(rows) } } as unknown as RpcClient;
    await act(() => root.render(<MicoTaskTabs botId="mico" scope="narrow" taskThreadId="b" rpc={rpc} onSelect={vi.fn()} />));
    expect(host.querySelector("nav")!.getAttribute("data-tabs-layout")).toBe("compact");
    expect(button("Beta · All conversations", host).textContent).toBe("Beta");
    expect(button("New conversation", host)).not.toBeNull();
    queryClient.setQueryData(["conversation-tabs", "tiny", "width"], 40);
    const tiny = mount();
    await act(() => tiny.root.render(<MicoTaskTabs botId="mico" scope="tiny" taskThreadId="b" rpc={rpc} onSelect={vi.fn()} />));
    expect(tiny.host.querySelector("nav")!.getAttribute("data-tabs-layout")).toBe("minimal");
    expect(button("New conversation", tiny.host)).toBeNull();
    expect(button("All conversations", tiny.host)).not.toBeNull();
  });
});

describe("readable conversation tabs", () => {
  const tabs = Array.from({ length: 8 }, (_, index) => ({ threadId: String(index), title: `Conversation ${index}` }));
  it("keeps the active conversation visible when many tabs are open", () => {
    expect(fitConversationTabs(tabs, "1", 740).map(tab => tab.threadId)).toEqual(["1", "7"]);
    expect(fitConversationTabs(tabs, "1", 280).map(tab => tab.threadId)).toEqual(["1"]);
  });
  it("shows recent tabs on the main chat and restores more only when space allows", () => {
    expect(fitConversationTabs(tabs, undefined, 740).map(tab => tab.threadId)).toEqual(["6", "7"]);
    expect(fitConversationTabs(tabs, "1", 2000)).toEqual(tabs);
    expect(fitConversationTabs([], undefined, 0)).toEqual([]);
    expect(fitConversationTabs(tabs, "1", 0).map(tab => tab.threadId)).toEqual(["1"]);
  });
});

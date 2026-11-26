// @vitest-environment jsdom
import type { ProjectSummary } from "@mycellios/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { projectHistoryPreloads } from "../lib/project-history-preload";
import type { RpcClient } from "../lib/rpc";
import { SidebarProjects } from "./SidebarProjects";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({ t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values) }),
}));

function project(name: string, numberOfChats: number): ProjectSummary {
  return { id: name, name, conversations: Array.from({ length: numberOfChats }, (_, index) => {
    const title = `${name} ${index + 1}`;
    return { botId: name, threadId: title, title, unread: true };
  }) };
}

it("warms the intended folder before opening it while another read is still pending", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const complete = new Map<string, () => void>();
  const fetchHistory = vi.fn((_botId: string, threadId: string) =>
    new Promise<void>(resolve => complete.set(threadId, resolve)));
  const cachedReads = new Map<string, Promise<void>>();
  function warm(botId: string, threadId: string): Promise<void> {
    const cached = cachedReads.get(threadId);
    if (cached) return cached;
    const read = fetchHistory(botId, threadId);
    cachedReads.set(threadId, read);
    return read;
  }
  const select = vi.fn();
  try {
    await act(() => root.render(<SidebarProjects projects={[project("Second", 16), project("First", 3)]}
      rpc={{} as RpcClient} bots={[]} creating={false} onCreating={() => undefined} onRefresh={() => undefined}
      onSelect={select} onWarm={warm} failed={false} />));
    expect(fetchHistory.mock.calls).toEqual([["First", "First 1"], ["First", "First 2"]]);
    expect(select).not.toHaveBeenCalled();

    const secondFolder = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Second")!;
    await act(() => secondFolder.focus());
    expect(secondFolder.getAttribute("aria-expanded")).toBe("false");
    expect(fetchHistory).toHaveBeenCalledTimes(2);
    await act(() => complete.get("First 1")!());
    expect(fetchHistory).toHaveBeenLastCalledWith("Second", "Second 1");
    expect(select).not.toHaveBeenCalled();
    await act(() => secondFolder.click());
    await act(() => complete.get("First 2")!());
    expect(fetchHistory).toHaveBeenLastCalledWith("Second", "Second 2");

    const laterChat = host.querySelector<HTMLButtonElement>('button[title="Second 16"]')!;
    await act(() => laterChat.focus());
    expect(fetchHistory).toHaveBeenLastCalledWith("Second", "Second 16");
    await act(() => laterChat.click());
    expect(select).toHaveBeenCalledWith("Second", "Second 16");
    await act(() => complete.get("Second 16")!());
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("plans every other conversation in small projects, including rows past five", () => {
  const targets = projectHistoryPreloads(
    [project("First", 3), project("Second", 6)], undefined, undefined, "Second 5", "Second 3",
  );
  expect(targets.map(([, id]) => id)).toEqual([
    "Second 5", "Second 1", "First 1", "First 2",
    "Second 2", "Second 4", "First 3", "Second 6",
  ]);
});

it("reserves the initial slots for the intended folder and bounds the background queue", () => {
  const targets = projectHistoryPreloads(
    [project("Intended", 20), project("Usual", 20)], "Intended", undefined, "Usual 19", undefined,
  );
  expect(targets).toHaveLength(12);
  expect(targets.slice(0, 4)).toEqual([
    ["Intended", "Intended 1"], ["Intended", "Intended 2"], ["Usual", "Usual 19"], ["Usual", "Usual 1"],
  ]);
});

it("starts with the last opened project chat only in its own account and Space", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const projects = [project("Usual", 5), project("Newest", 4)];
  const rememberedKey = "test:project-history:account:personal";
  const otherKey = "test:project-history:account:team";
  const warm = vi.fn((_botId: string, _threadId: string) => new Promise<void>(() => {}));
  const select = vi.fn();
  function mount(key: string, historyPreferenceKey: string, activeThread?: string, load = true, listed = projects) {
    return act(() => root.render(<SidebarProjects key={key} projects={listed} historyPreferenceKey={historyPreferenceKey}
      rpc={{} as RpcClient} bots={[]} activeThread={activeThread} creating={false}
      onCreating={() => undefined} onRefresh={() => undefined} onSelect={select}
      onWarm={load ? warm : undefined} failed={false} />));
  }
  try {
    await mount("initial", rememberedKey, "Usual 4", false);
    expect(localStorage.getItem(rememberedKey)).toBe("Usual 4");
    await mount("restart", rememberedKey);
    expect(warm.mock.calls).toEqual([["Usual", "Usual 4"], ["Usual", "Usual 1"]]);
    warm.mockClear();
    await mount("team", otherKey);
    expect(warm.mock.calls).toEqual([["Newest", "Newest 1"], ["Newest", "Newest 2"]]);
    warm.mockClear();
    await mount("removed", rememberedKey, undefined, true, [projects[1]!]);
    expect(warm.mock.calls).toEqual([["Newest", "Newest 1"], ["Newest", "Newest 2"]]);
    expect(select).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    localStorage.removeItem(rememberedKey);
    localStorage.removeItem(otherKey);
    host.remove();
    vi.unstubAllGlobals();
  }
});

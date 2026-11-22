// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "./query";
import {
  micoConversationScope, setMicoConversationsOpen, sidebarConversationRows, sidebarListedRows, useOpenMicoConversations,
  useSidebarConversationRows,
} from "./sidebar-conversations";
import type { ConversationRow } from "./thread-tabs";

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 22, 12, 0) - minutes * 60_000).toISOString();
const row = (threadId: string, extra: Partial<ConversationRow> = {}): ConversationRow =>
  ({ threadId, title: threadId, state: "idle", updatedAt: at(0), ...extra });

beforeEach(() => { localStorage.clear(); queryClient.clear(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });

describe("conversations under a Mico in the sidebar", () => {
  const rows = [
    row("old", { updatedAt: at(90) }), row("asks", { state: "waiting", updatedAt: at(80) }), row("new", { updatedAt: at(1) }),
    row("reply", { unread: true, updatedAt: at(70) }), row("failed", { outcome: "failed", updatedAt: at(60) }),
    row("mid", { updatedAt: at(30) }), row("older", { updatedAt: at(50) }), row("gone", { archived: true, state: "closed" }),
    row("deleting", { deleteAfter: at(-1) }),
  ];

  it("lists every conversation that needs a look, then the three most recent others", () => {
    const shown = sidebarConversationRows(rows);
    expect(shown.needLook.map(item => item.threadId)).toEqual(["failed", "reply", "asks"]);
    expect(shown.recent.map(item => item.threadId)).toEqual(["new", "mid", "older"]);
    expect(shown.hidden).toBe(1);
    expect(shown.total).toBe(7);
    expect(sidebarConversationRows(rows, true).recent.map(item => item.threadId)).toEqual(["new", "mid", "older", "old"]);
  });

  it("leaves project sessions to their project and shares the tabs' list key", () => {
    expect(sidebarListedRows([{ projectKey: "project:a" }, { projectKey: "mico:b" }, {}])).toEqual([{ projectKey: "mico:b" }, {}]);
    expect(micoConversationScope("user", "space", "mico")).toBe(JSON.stringify(["user", "space", "mico"]));
  });

  it("remembers which Micos are expanded on this device", async () => {
    const seen: string[][] = [];
    function Probe() { seen.push([...useOpenMicoConversations()]); return null; }
    const root = createRoot(document.createElement("div"));
    await act(() => root.render(createElement(Probe)));
    await act(() => setMicoConversationsOpen("mico", true));
    await act(() => setMicoConversationsOpen("mico", true));
    expect(seen.at(-1)).toEqual(["mico"]);
    await act(() => setMicoConversationsOpen("mico", false));
    expect(seen.at(-1)).toEqual([]);
    await act(() => root.unmount());
  });

  it("reads the list for an expanded row and again only when the roster says it moved", async () => {
    const list = vi.fn().mockResolvedValue([{ threadId: "a", title: "A", projectKey: "mico:m", taskKey: "a" },
      { threadId: "p", title: "P", projectKey: "project:x", taskKey: "p" }]);
    const states: Array<{ rows: ConversationRow[]; loaded: boolean }> = [];
    const rpc = { development: { list } } as never;
    function Probe({ revision }: { revision: string }) {
      states.push(useSidebarConversationRows({ enabled: true, rpc, scope: "s", botId: "m", revision }));
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(() => root.render(createElement(Probe, { revision: "1" })));
    expect(states.at(-1)).toMatchObject({ loaded: true, rows: [{ threadId: "a" }] });
    await act(() => root.render(createElement(Probe, { revision: "1" })));
    expect(list).toHaveBeenCalledTimes(1);
    await act(() => root.render(createElement(Probe, { revision: "2" })));
    expect(list).toHaveBeenCalledTimes(2);
    await act(() => root.unmount());
  });
});

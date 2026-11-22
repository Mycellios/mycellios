// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_SIDEBAR_FILTER, filterSidebarGroups, parseSidebarFilter, readSidebarFilter, rowMatchesSidebarFilter,
  SIDEBAR_FILTER_KEY, sidebarFilterActive, toggleSidebarFilter, writeSidebarFilter,
} from "./sidebar-filter";

vi.mock("@lingui/core/macro", () => ({ t: (strings: TemplateStringsArray) => strings.join("") }));

const bot = (id: string, chat: Record<string, unknown> = {}) => ({ kind: "bot" as const, chat: { id, status: "idle", sectionId: null, ...chat } });
const group = (id: string, chat: Record<string, unknown> = {}) => ({ kind: "group" as const, chat: { id, sectionId: null, members: [], ...chat } });
const ids = (groups: { bots: { chat: { id?: unknown } }[] }[]) => groups.flatMap(item => item.bots.map(row => row.chat.id));
const folders = [
  { id: "work", ancestorIds: [] },
  { id: "clients", ancestorIds: ["work"] },
  { id: "home", ancestorIds: [] },
];
const groups = [
  { key: "pinned", bots: [bot("pinned", { unread: true })] },
  { key: "section:work", bots: [bot("writer", { sectionId: "work", status: "running" }), group("team", { sectionId: "work", unread: true })] },
  { key: "section:clients", bots: [bot("sales", { sectionId: "clients", conversations: { unread: 2, working: 0 } })] },
  { key: "section:home", bots: [bot("cook", { sectionId: "home", conversations: { unread: 0, working: 1 } }), group("family", { sectionId: "home", members: [{ status: "queued" }] })] },
];

beforeEach(() => localStorage.clear());

describe("sidebar filter", () => {
  it("reads only known choices and survives damaged storage", () => {
    expect(parseSidebarFilter("{broken")).toBe(EMPTY_SIDEBAR_FILTER);
    expect(parseSidebarFilter(JSON.stringify({ kinds: ["bot", "robot", "bot"], states: ["unread", "sleeping"], folders: ["a", 3, ""] })))
      .toEqual({ kinds: ["bot"], states: ["unread"], folders: ["a"] });
    expect(sidebarFilterActive(EMPTY_SIDEBAR_FILTER)).toBe(false);
    expect(toggleSidebarFilter(toggleSidebarFilter(EMPTY_SIDEBAR_FILTER, "kinds", "group"), "kinds", "group")).toEqual(EMPTY_SIDEBAR_FILTER);
  });

  it("leaves every section as it is without a filter", () => {
    const before = JSON.stringify(groups);
    expect(filterSidebarGroups(groups, EMPTY_SIDEBAR_FILTER, folders)).toEqual(groups);
    expect(JSON.stringify(groups)).toBe(before);
  });

  it("narrows by kind, by state (any of them) and by folder with its subfolders, dropping empty sections", () => {
    expect(ids(filterSidebarGroups(groups, { ...EMPTY_SIDEBAR_FILTER, kinds: ["group"] }, folders))).toEqual(["team", "family"]);
    // Unread counts replies in conversations; working counts conversations and group members.
    expect(ids(filterSidebarGroups(groups, { ...EMPTY_SIDEBAR_FILTER, states: ["unread"] }, folders))).toEqual(["pinned", "team", "sales"]);
    expect(ids(filterSidebarGroups(groups, { ...EMPTY_SIDEBAR_FILTER, states: ["working"] }, folders))).toEqual(["writer", "cook", "family"]);
    expect(ids(filterSidebarGroups(groups, { ...EMPTY_SIDEBAR_FILTER, folders: ["work"] }, folders))).toEqual(["writer", "team", "sales"]);
    const both = filterSidebarGroups(groups, { kinds: ["bot"], states: ["unread", "working"], folders: ["work"] }, folders);
    expect(ids(both)).toEqual(["writer", "sales"]);
    expect(both.map(item => item.key)).toEqual(["section:work", "section:clients"]);
  });

  it("ignores folders that no longer exist so a stale choice cannot hide everything", () => {
    expect(ids(filterSidebarGroups(groups, { ...EMPTY_SIDEBAR_FILTER, folders: ["deleted"] }, folders))).toEqual(ids(groups));
    expect(rowMatchesSidebarFilter(bot("loose"), { ...EMPTY_SIDEBAR_FILTER, folders: ["work"] }, new Set(["work"]))).toBe(false);
  });

  it("is saved per device and read back", () => {
    writeSidebarFilter({ kinds: ["bot"], states: [], folders: [] });
    expect(JSON.parse(localStorage.getItem(SIDEBAR_FILTER_KEY) ?? "{}")).toEqual({ kinds: ["bot"], states: [], folders: [] });
    expect(readSidebarFilter().kinds).toEqual(["bot"]);
  });
});

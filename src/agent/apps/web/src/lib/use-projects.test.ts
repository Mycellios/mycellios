import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createProjectHistoryPreloader, projectHistoryPreferenceKey } from "./project-history-preload";
import { warmInitialProjectHistories } from "./use-projects";

const { createSpaceRpc, fetchQuery, readConversationHistory } = vi.hoisted(() => ({
  createSpaceRpc: vi.fn(),
  fetchQuery: vi.fn(),
  readConversationHistory: vi.fn(),
}));

vi.mock("./rpc", () => ({ createSpaceRpc }));
vi.mock("./query", () => ({
  queryClient: { fetchQuery, getQueryData: vi.fn() },
  readConversationHistory,
  spaceQueries: () => ({ threads: { get: { queryKey: () => [] } } }),
}));

const getItem = vi.fn();
const project = {
  id: "project",
  name: "Project",
  conversations: ["newest", "next", "remembered", "later", "oldest"].map(threadId => ({
    botId: "mico", threadId, title: threadId, unread: true,
  })),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("localStorage", { getItem });
});
afterEach(() => vi.unstubAllGlobals());

it("starts warming all five chats before the sidebar mounts, with the remembered chat first", async () => {
  let releaseList = (_projects: typeof project[]) => {};
  fetchQuery.mockReturnValue(new Promise(resolve => { releaseList = resolve; }));
  const finish = new Map<string, () => void>();
  readConversationHistory.mockImplementation((_user, _space, _bot, { taskThreadId }) =>
    new Promise<void>(resolve => finish.set(taskThreadId, resolve)));
  getItem.mockReturnValue("remembered");

  const warming = warmInitialProjectHistories("account", "space");
  expect(getItem).toHaveBeenCalledWith(projectHistoryPreferenceKey("account", "space"));
  expect(createSpaceRpc).toHaveBeenCalledWith("space");
  expect(fetchQuery).toHaveBeenCalledWith(expect.objectContaining({
    queryKey: ["development-projects", "account", "space"],
  }));
  expect(readConversationHistory).not.toHaveBeenCalled();

  releaseList([project]);
  await warming;
  expect(readConversationHistory).toHaveBeenNthCalledWith(1,
    "account", "space", "mico", { botId: "mico", taskThreadId: "remembered" },
  );
  expect(readConversationHistory).toHaveBeenCalledTimes(2);
  finish.get("newest")!();
  await vi.waitFor(() => expect(finish.has("next")).toBe(true));
  finish.get("next")!();
  await vi.waitFor(() => expect(finish.has("later")).toBe(true));
  finish.get("later")!();
  await vi.waitFor(() => expect(finish.has("oldest")).toBe(true));
  expect(readConversationHistory).toHaveBeenCalledTimes(5);
  finish.get("oldest")!();
  finish.get("remembered")!();
});

it("uses the scoped list even when there is no remembered conversation", async () => {
  fetchQuery.mockResolvedValue([project]);
  getItem.mockReturnValue(null);
  await warmInitialProjectHistories("account", "other-space");
  expect(fetchQuery).toHaveBeenCalledWith(expect.objectContaining({
    queryKey: ["development-projects", "account", "other-space"],
  }));
  await vi.waitFor(() => expect(readConversationHistory).toHaveBeenCalledTimes(5));
  expect(readConversationHistory).toHaveBeenNthCalledWith(1,
    "account", "other-space", "mico", { botId: "mico", taskThreadId: "newest" },
  );
});

it("skips the preload when hidden or when no chats are listed", async () => {
  getItem.mockReturnValue("remembered");
  vi.stubGlobal("document", { visibilityState: "hidden" });
  await warmInitialProjectHistories("account", "hidden-space");
  expect(fetchQuery).not.toHaveBeenCalled();

  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() });
  fetchQuery.mockResolvedValue([]);
  await warmInitialProjectHistories("account", "empty-space");
  expect(readConversationHistory).not.toHaveBeenCalled();
});

it("shares the two slots when the sidebar takes over and skips in-flight duplicates", async () => {
  const queue = createProjectHistoryPreloader();
  const finish = new Map<string, () => void>();
  const warm = vi.fn((_botId: string, threadId: string) =>
    new Promise<void>(resolve => finish.set(threadId, resolve)));
  queue.schedule([], warm);
  const stopStartup = queue.schedule([["mico", "a"], ["mico", "b"], ["mico", "old"]], warm, true);
  const stopSidebar = queue.schedule([["mico", "a"], ["mico", "clicked-folder"]], warm);
  queue.schedule([["mico", "stale-startup"]], warm, true);
  stopStartup?.();
  expect(warm.mock.calls.map(([, id]) => id)).toEqual(["a", "b"]);
  finish.get("b")!();
  await vi.waitFor(() => expect(finish.has("clicked-folder")).toBe(true));
  expect(warm.mock.calls.map(([, id]) => id)).toEqual(["a", "b", "clicked-folder"]);
  stopSidebar?.();
  finish.get("a")!();
  finish.get("clicked-folder")!();
});

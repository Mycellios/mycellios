import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { projectHistoryPreferenceKey } from "./project-history-preload";
import { warmRememberedProjectHistory } from "./use-projects";

const { createSpaceRpc, fetchQuery, readConversationHistory } = vi.hoisted(() => ({
  createSpaceRpc: vi.fn(),
  fetchQuery: vi.fn(),
  readConversationHistory: vi.fn(),
}));

vi.mock("./rpc", () => ({ createSpaceRpc }));
vi.mock("./query", () => ({ queryClient: { fetchQuery }, readConversationHistory }));

const getItem = vi.fn();
const project = {
  id: "project",
  name: "Project",
  conversations: [{ botId: "mico", threadId: "remembered", title: "Conversation", unread: true }],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("document", { visibilityState: "visible" });
  vi.stubGlobal("localStorage", { getItem });
});
afterEach(() => vi.unstubAllGlobals());

it("starts only the remembered history after the scoped project list confirms it", async () => {
  let releaseList = (_projects: typeof project[]) => {};
  fetchQuery.mockReturnValue(new Promise(resolve => { releaseList = resolve; }));
  getItem.mockReturnValue("remembered");

  const warming = warmRememberedProjectHistory("account", "space");
  expect(getItem).toHaveBeenCalledWith(projectHistoryPreferenceKey("account", "space"));
  expect(createSpaceRpc).toHaveBeenCalledWith("space");
  expect(fetchQuery).toHaveBeenCalledWith(expect.objectContaining({
    queryKey: ["development-projects", "account", "space"],
  }));
  expect(readConversationHistory).not.toHaveBeenCalled();

  releaseList([project]);
  await warming;
  expect(readConversationHistory).toHaveBeenCalledExactlyOnceWith(
    "account", "space", "mico", { botId: "mico", taskThreadId: "remembered" },
  );
});

it("skips the preload when the preference is absent, hidden or no longer listed", async () => {
  getItem.mockReturnValue(null);
  await warmRememberedProjectHistory("account", "other-space");
  expect(fetchQuery).not.toHaveBeenCalled();

  getItem.mockReturnValue("remembered");
  vi.stubGlobal("document", { visibilityState: "hidden" });
  await warmRememberedProjectHistory("account", "space");
  expect(fetchQuery).not.toHaveBeenCalled();

  vi.stubGlobal("document", { visibilityState: "visible" });
  fetchQuery.mockResolvedValue([]);
  await warmRememberedProjectHistory("account", "space");
  expect(readConversationHistory).not.toHaveBeenCalled();
});

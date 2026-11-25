// @vitest-environment jsdom
import type { SpaceMembers } from "@mycellios/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SpaceMicosPanel } from "./SpaceMicosPanel";

const mocks = vi.hoisted(() => ({
  list: vi.fn(async () => ({
    micos: [{
      botId: "mico", name: "Notes", ownerName: "Owner",
      allowanceLeftMicros: 1_000_000, conversations: [],
    }],
  })),
  open: vi.fn(async () => ({ threadId: "own-thread" })),
  get: vi.fn(async () => ({ messages: [], run: null })),
  send: vi.fn(async () => ({ runId: "run" })),
  listShares: vi.fn(async () => []),
  setShare: vi.fn(),
}));
vi.mock("../lib/space-rpc", () => ({
  useBoundSpaceId: () => "space",
  useSpaceRpc: () => ({
    sharedMicos: { list: mocks.list, open: mocks.open, get: mocks.get, send: mocks.send },
    spaces: { shares: { list: mocks.listShares, set: mocks.setShare } },
  }),
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
}));
vi.mock("../lib/user-error", () => ({ errorText: () => "Unavailable" }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("opens a member's own conversation through the scoped sharing endpoint", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const members = { role: "member", people: [{ userId: "member", you: true, role: "member" }] } as SpaceMembers;
  await act(async () => root.render(<QueryClientProvider client={client}>
    <SpaceMicosPanel members={members} />
  </QueryClientProvider>));
  const openButton = () => [...host.querySelectorAll("button")].find((button) => button.textContent === "New conversation");
  await act(async () => vi.waitFor(() => expect(mocks.list).toHaveBeenCalled()));
  await vi.waitFor(() => expect(openButton()).toBeTruthy());
  await act(async () => openButton()?.click());
  await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledWith({
    botId: "mico", taskThreadId: "own-thread", history: "recent",
  }));
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith({ botId: "mico", requestKey: expect.any(String) });
  expect(mocks.listShares).not.toHaveBeenCalled();
});

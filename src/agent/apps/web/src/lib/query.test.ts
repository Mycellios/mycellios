import { QueryObserver } from "@tanstack/react-query";
import type { AppBootstrap } from "@mycellios/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./rpc", () => {
  // Any procedure path, as the real client exposes; these tests never call one.
  const client = (): unknown => new Proxy(() => undefined, { get: () => client() });
  return {
    rpc: client(),
    createSpaceRpc: client,
    rpcForSpace: client,
    selectedSpaceId: () => null,
  };
});

import type { DataTag, QueryKey } from "@tanstack/react-query";
import {
  fetchFresh,
  lastChatKey,
  lastChatOf,
  queryClient,
  primeConversationSeed,
  seedOnLeave,
  setQueryUser,
  spaceQueries,
  spaceSeedKey,
} from "./query";

afterEach(() => {
  queryClient.clear();
});

describe("query scopes", () => {
  it("separates private task snapshots from the main chat and other tasks", () => {
    const a = { botId: "mico", taskThreadId: "one" };
    const b = { botId: "mico", taskThreadId: "two" };
    const keys = [spaceSeedKey("owner", "space"), spaceSeedKey("owner", "space", a), spaceSeedKey("owner", "space", b)];
    expect(new Set(keys.map(key => JSON.stringify(key))).size).toBe(3);
    queryClient.setQueryData(keys[1]!, { marker: "private" } as never);
    expect(queryClient.getQueryData(keys[0]!)).toBeUndefined();
    expect(queryClient.getQueryData(keys[2]!)).toBeUndefined();
  });
  it("keeps every user and space in its own keys", () => {
    const keys = [
      spaceQueries("user-a", "space-a"),
      spaceQueries("user-a", "space-b"),
      spaceQueries("user-b", "space-a"),
      spaceQueries("user-a", null),
    ].map((scope) => JSON.stringify(scope.bootstrap.queryKey({ input: {} })));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never serves one space's cached data to another", () => {
    queryClient.setQueryData(spaceQueries("user-a", "space-a").voice.status.queryKey(), {
      ready: true,
    } as never);
    expect(
      queryClient.getQueryData(spaceQueries("user-a", "space-b").voice.status.queryKey()),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(spaceQueries("user-b", "space-a").voice.status.queryKey()),
    ).toBeUndefined();
  });

  it("keeps the unselected space's seed apart from every chosen space", () => {
    const keys = [spaceSeedKey("user-a", null), spaceSeedKey("user-a", "space-a")].map((key) =>
      JSON.stringify(key),
    );
    expect(new Set(keys).size).toBe(2);
  });

  it("forgets the cache when a different user signs in or everyone signs out", () => {
    const key = spaceQueries("user-a", "space-a").voice.status.queryKey();
    setQueryUser("user-a");
    queryClient.setQueryData(key, { ready: true } as never);
    setQueryUser("user-a");
    expect(queryClient.getQueryData(key)).toBeDefined();
    setQueryUser(null);
    expect(queryClient.getQueryData(key)).toBeUndefined();
    queryClient.setQueryData(key, { ready: true } as never);
    setQueryUser("user-b");
    expect(queryClient.getQueryData(key)).toBeUndefined();
  });
});

describe("the chat a space reopens with", () => {
  const seed = (thread: { botId?: string; groupId?: string } | null) =>
    ({
      bots: [{ id: "bot-a" }],
      groups: [{ id: "group-a" }],
      thread,
    }) as never;

  it("reopens the bot or group chat a cached space had selected", () => {
    expect(lastChatOf(seed(null), { botId: "bot-a" })).toEqual({ botId: "bot-a" });
    expect(lastChatOf(seed(null), { groupId: "group-a" })).toEqual({ groupId: "group-a" });
  });

  it("falls back when the selected chat is gone or nothing is cached", () => {
    expect(lastChatOf(seed(null), { botId: "bot-gone" })).toBeUndefined();
    expect(lastChatOf(seed(null), { groupId: "group-gone" })).toBeUndefined();
    expect(lastChatOf(seed(null), undefined)).toBeUndefined();
    expect(lastChatOf(undefined, { botId: "bot-a" })).toBeUndefined();
  });

  it("keeps a selected group that had not loaded yet over the previous bot's snapshot", () => {
    const previous = seed({ botId: "bot-old" });
    const botSnapshot = { botId: "bot-a", messages: [] } as never;
    const left = seedOnLeave(previous, {} as never, { groupId: "group-a" }, botSnapshot);
    expect(left.thread).toEqual({ botId: "bot-old" });
    expect(lastChatOf(left, { groupId: "group-a" })).toEqual({ groupId: "group-a" });
  });

  it("keeps the selected chat's own snapshot", () => {
    const groupSnapshot = { groupId: "group-a", botId: "bot-a", messages: [] } as never;
    expect(seedOnLeave(seed(null), {} as never, { groupId: "group-a" }, groupSnapshot).thread).toBe(
      groupSnapshot,
    );
    const botSnapshot = { botId: "bot-a", messages: [] } as never;
    expect(seedOnLeave(seed(null), {} as never, { botId: "bot-a" }, botSnapshot).thread).toBe(
      botSnapshot,
    );
    expect(seedOnLeave(seed(null), {} as never, { botId: "bot-a" }, groupSnapshot).thread).toBe(
      null,
    );
  });

  it("keeps each user's and space's last chat apart", () => {
    const keys = [
      lastChatKey("user-a", "space-a"),
      lastChatKey("user-a", "space-b"),
      lastChatKey("user-b", "space-a"),
      spaceSeedKey("user-a", "space-a"),
    ].map((key) => JSON.stringify(key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("conversation navigation without a whole-page loading frame", () => {
  const latest = { me: { spaceId: "space" }, bots: [{ id: "mico" }], groups: [],
    botSections: [], archivedBots: [], archivedGroups: [], spaces: [] } as unknown as Omit<AppBootstrap, "thread" | "routines">;
  const a = { botId: "mico", taskThreadId: "one" };
  const b = { botId: "mico", taskThreadId: "two" };

  it("primes an unseen conversation with the sidebar, never the departing transcript", () => {
    queryClient.setQueryData(spaceSeedKey("owner", "space", a), {
      ...latest, thread: { botId: "mico", threadId: "one", messages: ["private A"] }, routines: ["A"],
    } as never);
    primeConversationSeed("owner", "space", latest, "mico", b);
    const seed = queryClient.getQueryData(spaceSeedKey("owner", "space", b))!;
    expect(seed.bots).toEqual([{ id: "mico" }]);
    expect(seed.thread).toBeNull(); expect(seed.routines).toEqual([]);
    expect(queryClient.getQueryData(spaceSeedKey("owner", "space", a))?.thread?.threadId).toBe("one");
  });

  it("reopens an already visited task with its own cached messages immediately", () => {
    const thread = { botId: "mico", threadId: "two", messages: ["B"] } as never;
    queryClient.setQueryData(spaceQueries("owner", "space", b).threads.get.queryKey({input:{botId:"mico"}}), thread);
    primeConversationSeed("owner", "space", latest, "mico", b);
    expect(queryClient.getQueryData(spaceSeedKey("owner", "space", b))?.thread).toBe(thread);
  });

  it("discards an incorrectly scoped cached snapshot and leaves other accounts/spaces untouched", () => {
    const key = spaceQueries("owner", "space", b).threads.get.queryKey({input:{botId:"mico"}});
    queryClient.setQueryData(key, {botId:"mico", threadId:"one"} as never);
    primeConversationSeed("owner", "space", latest, "mico", b);
    expect(queryClient.getQueryData(spaceSeedKey("owner", "space", b))?.thread).toBeNull();
    expect(queryClient.getQueryData(spaceSeedKey("other", "space", b))).toBeUndefined();
    expect(queryClient.getQueryData(spaceSeedKey("owner", "other", b))).toBeUndefined();
  });

  it("returns to the main chat without borrowing a task or group transcript", () => {
    primeConversationSeed("owner", "space", latest, "mico", a);
    primeConversationSeed("owner", "space", latest, "mico");
    expect(queryClient.getQueryData(spaceSeedKey("owner", "space"))?.thread).toBeNull();
    queryClient.setQueryData(spaceSeedKey("owner", "space"), { ...latest,
      thread: {botId:"mico",groupId:"group"} } as never);
    primeConversationSeed("owner", "space", latest, "mico");
    expect(queryClient.getQueryData(spaceSeedKey("owner", "space"))?.thread).toBeNull();
  });
});

describe("the shared query client", () => {
  it("refreshes a screen every time it opens, even right after a read", async () => {
    const queryFn = vi.fn(async () => "value");
    const options = { queryKey: ["screen-open-test"], queryFn };
    for (const _open of [1, 2]) {
      const observer = new QueryObserver(queryClient, options);
      const unsubscribe = observer.subscribe(() => undefined);
      await vi.waitFor(() => expect(observer.getCurrentResult().isFetching).toBe(false));
      unsubscribe();
    }
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("gives a refresh cancelled by a newer one that newer answer instead of failing", async () => {
    const queryKey = ["fresh-race-test"] as unknown as DataTag<QueryKey, string, Error>;
    const answers = ["first", "second"];
    const resolvers: Array<() => void> = [];
    const queryFn = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<string>((resolve, reject) => {
          const answer = answers.shift() ?? "later";
          signal.addEventListener("abort", () => reject(signal.reason));
          resolvers.push(() => resolve(answer));
        }),
    );
    const saveRefresh = fetchFresh(queryClient, { queryKey, queryFn });
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    // A live event refreshes the same list while the save's refresh is still out.
    const eventRefresh = fetchFresh(queryClient, { queryKey, queryFn });
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    resolvers[1]?.();
    await expect(saveRefresh).resolves.toBe("second");
    await expect(eventRefresh).resolves.toBe("second");
  });
});

import { describe, expect, it, vi } from "vitest";
import type { Actor } from "@mycellios/contracts";
import type { RouterDeps } from "./router.js";
import { conversationTokens, threadContext } from "./thread-context.js";

vi.mock("@mycellios/adapters", () => ({ catalogContextWindow: () => null }));

const actor = { userId: "owner", spaceId: "space" } as Actor;
const usage = {
  provider: "anthropic", model: "claude-test", createdAt: new Date("2026-11-27T08:00:00Z"),
  inputTokens: 1_000, outputTokens: 500, cacheReadTokens: 40_000, cacheWriteTokens: 8_500,
};

function fixture({ thread = { id: "thread" } as { id: string } | null, bot = { id: "bot" } as { id: string } | null,
  runs = [{ id: "run-2" }, { id: "run-1" }], last = usage as typeof usage | null } = {}) {
  const findThread = vi.fn(async () => thread);
  const findBot = vi.fn(async () => bot);
  const findRuns = vi.fn(async () => runs);
  const findUsage = vi.fn(async () => last);
  const deps = { prisma: {
    thread: { findFirst: findThread }, bot: { findFirst: findBot },
    run: { findMany: findRuns }, usageRecord: { findFirst: findUsage },
  } } as unknown as RouterDeps;
  return { deps, findThread, findBot, findRuns, findUsage };
}

describe("conversation context", () => {
  it("counts every token the latest answer read and wrote", () => {
    expect(conversationTokens(usage)).toBe(50_000);
    expect(conversationTokens({ inputTokens: null, outputTokens: 10, cacheReadTokens: null, cacheWriteTokens: -1 })).toBe(10);
  });

  it("reads the main chat's latest answer inside the owner's Space", async () => {
    const f = fixture();
    const result = await threadContext(f.deps, actor, { botId: "bot" }, () => 200_000);
    expect(result).toEqual({ model: "claude-test", at: "2026-11-27T08:00:00.000Z", usedTokens: 50_000, contextWindow: 200_000 });
    expect(f.findThread.mock.calls[0][0].where).toEqual({ userId: "owner", spaceId: "space", botId: "bot" });
    expect(f.findRuns.mock.calls[0][0]).toMatchObject({ where: { userId: "owner", spaceId: "space", threadId: "thread" }, take: 10 });
    expect(f.findUsage.mock.calls[0][0].where).toMatchObject({ userId: "owner", spaceId: "space", operationKind: "answer",
      runId: { in: ["run-2", "run-1"] } });
  });

  it("reads a side conversation only when it belongs to that Mico", async () => {
    const f = fixture();
    await threadContext(f.deps, actor, { botId: "bot", taskThreadId: "side" }, () => null);
    expect(f.findThread.mock.calls[0][0].where).toEqual({ userId: "owner", spaceId: "space", id: "side", taskBotId: "bot" });
    await expect(threadContext(fixture({ thread: null }).deps, actor, { botId: "bot", taskThreadId: "other" })).rejects.toThrow();
  });

  it("keeps an unknown window unknown and reports nothing before the first answer", async () => {
    expect((await threadContext(fixture().deps, actor, { botId: "bot" }, () => null))?.contextWindow).toBeNull();
    expect(await threadContext(fixture({ runs: [] }).deps, actor, { botId: "bot" })).toBeNull();
    expect(await threadContext(fixture({ last: null }).deps, actor, { botId: "bot" })).toBeNull();
    expect(await threadContext(fixture({ thread: null }).deps, actor, { botId: "bot" })).toBeNull();
    await expect(threadContext(fixture({ thread: null, bot: null }).deps, actor, { botId: "bot" })).rejects.toThrow();
  });
});

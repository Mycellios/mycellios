import type { PrismaClient } from "@mycellios/db";
import { appendEventInTransaction, createThreadMessageInTransaction } from "@mycellios/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adoptLocalEngines, localEngineAdoptionNote } from "./local-engine-adoption.js";

vi.mock("@mycellios/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mycellios/db")>()),
  createThreadMessageInTransaction: vi.fn(async () => ({ id: "note" })),
  appendEventInTransaction: vi.fn(async () => undefined),
  withTransactionRetry: (action: () => unknown) => action(),
}));

const actor = { userId: "owner", spaceId: "space" };

function fixture(options: { busyRun?: string; busyTask?: string; changed?: string } = {}) {
  const database = {
    bot: {
      findMany: vi.fn().mockResolvedValue([{ id: "idle" }, { id: "busy-run" }, { id: "busy-task" }, { id: "no-cli" }]),
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === options.changed ? null : { id: where.id, thread: { id: `thread-${where.id}` } }),
      update: vi.fn(async () => undefined),
    },
    run: { findFirst: vi.fn(async ({ where }: { where: { botId: string } }) => where.botId === options.busyRun ? { id: "run" } : null) },
    task: { findFirst: vi.fn(async ({ where }: { where: { botId: string } }) => where.botId === options.busyTask ? { id: "task" } : null) },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(),
  };
  database.$transaction.mockImplementation((action: (tx: unknown) => unknown) => action(database));
  return { database, prisma: database as unknown as PrismaClient };
}

beforeEach(() => {
  vi.mocked(createThreadMessageInTransaction).mockClear();
  vi.mocked(appendEventInTransaction).mockClear();
});

describe("one-time move of existing This PC Micos", () => {
  it("moves only idle Micos with a signed-in CLI, keeps their model and leaves a note", async () => {
    const { database, prisma } = fixture({ busyRun: "busy-run", busyTask: "busy-task" });
    const engineFor = vi.fn(async (botId: string) => botId === "no-cli" ? undefined : "claude" as const);
    expect(await adoptLocalEngines(prisma, actor, engineFor)).toEqual([{ botId: "idle", engine: "claude" }]);
    // Only Pi Micos on This PC that never moved are candidates.
    expect(database.bot.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ...actor, agentEngine: "pi", localEngineAdoptedAt: null, archivedAt: null,
        computer: { kind: "desktop", scope: "dedicated" } }),
    }));
    expect(database.bot.update).toHaveBeenCalledOnce();
    expect(database.bot.update).toHaveBeenCalledWith({
      where: { id: "idle" }, data: { agentEngine: "claude", localEngineAdoptedAt: expect.any(Date) },
    });
    const blocks = [{ kind: "meta", text: localEngineAdoptionNote("claude") }];
    expect(createThreadMessageInTransaction).toHaveBeenCalledWith(database, expect.objectContaining({
      threadId: "thread-idle", role: "system", blocks, clientNonce: "local-engine-adoption:idle",
    }));
    expect(appendEventInTransaction).toHaveBeenCalledOnce();
  });

  it("changes nothing when the Mico changed meanwhile or its PC gives no answer", async () => {
    const { database, prisma } = fixture({ changed: "idle" });
    const engineFor = vi.fn(async (botId: string) => {
      if (botId === "busy-run") throw new Error("PC offline");
      return botId === "idle" ? "codex" as const : undefined;
    });
    expect(await adoptLocalEngines(prisma, actor, engineFor)).toEqual([]);
    expect(database.bot.update).not.toHaveBeenCalled();
    expect(createThreadMessageInTransaction).not.toHaveBeenCalled();
  });

  it("names the engine and the way back in the note", () => {
    expect(localEngineAdoptionNote("codex")).toContain("Codex");
    expect(localEngineAdoptionNote("claude")).toContain("model menu");
  });
});

import type { Actor } from "@rakazo/contracts";
import { RunLogsInputSchema, RunLogsOutputSchema } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { listRunLogs, runLogIssue } from "./run-logs.js";

const actor: Actor = {
  userId: "owner",
  spaceId: "workspace",
  email: "owner@example.test",
  isDeploymentOwner: false,
};
const at = new Date("2026-01-02T10:00:00Z");
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-2",
    botId: "agent",
    status: "running",
    trigger: "user",
    error: null,
    createdAt: at,
    updatedAt: at,
    startedAt: null,
    firstResponseAt: null,
    completedAt: null,
    modelProvider: null,
    modelId: null,
    leaseFence: 4,
    bot: { name: "Video studio", computerId: null },
    _count: { attempts: 0 },
    attempts: [],
    ...overrides,
  };
}
function fixture(rows = [row()]) {
  const findRuns = vi.fn().mockResolvedValue(rows);
  const findBots = vi.fn().mockResolvedValue([{ id: "agent", name: "Video studio" }]);
  const prisma = {
    run: { findMany: findRuns },
    bot: { findMany: findBots },
  } as unknown as PrismaClient;
  return { prisma, findRuns, findBots };
}

describe("owned execution logs", () => {
  it("exposes pre-start blockers without inventing an execution attempt", async () => {
    const { prisma } = fixture();
    const result = await listRunLogs(prisma, actor, {});
    expect(RunLogsOutputSchema.safeParse(result).success).toBe(true);
    expect(result.runs[0]).toMatchObject({
      issue: "computer_missing",
      status: "running",
      startedAt: null,
      dispatchCount: 4,
      attemptCount: 0,
      attempts: [],
    });
  });
  it("keeps every read scoped to both owner and space, including a foreign bot filter", async () => {
    const { prisma, findRuns, findBots } = fixture([]);
    await listRunLogs(prisma, actor, { botId: "somebody-elses-agent" });
    expect(findRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "owner",
          spaceId: "workspace",
          botId: "somebody-elses-agent",
          bot: { userId: "owner", spaceId: "workspace" },
        },
        take: 26,
      }),
    );
    expect(findBots).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "owner", spaceId: "workspace", archivedAt: null },
        take: 200,
      }),
    );
  });
  it("uses a stable keyset cursor and bounds related attempts", async () => {
    const { prisma, findRuns } = fixture([row(), row({ id: "run-1" })]);
    const result = await listRunLogs(prisma, actor, {
      limit: 1,
      before: { id: "run-3", createdAt: at.toISOString() },
    });
    expect(result.runs.map((run) => run.id)).toEqual(["run-2"]);
    expect(result.nextCursor).toEqual({ id: "run-2", createdAt: at.toISOString() });
    expect(findRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        where: expect.objectContaining({
          OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: "run-3" } }],
        }),
        select: expect.objectContaining({ attempts: expect.objectContaining({ take: 10 }) }),
      }),
    );
  });
  it("does not publish raw provider errors, prompts, paths, tokens or checkpoints", async () => {
    const secret = "private-fragment-not-for-the-client";
    const { prisma, findRuns } = fixture([
      row({
        status: "failed",
        error: `Authorization: ${secret}\nC:\\Users\\Private\\secret.txt`,
        checkpoint: secret,
        attempts: [
          { id: "attempt-1", status: "failed", error: secret, startedAt: at, finishedAt: at },
        ],
        _count: { attempts: 1 },
      }),
    ]);
    const result = await listRunLogs(prisma, actor, {});
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.runs[0]).toMatchObject({
      issue: "execution_failed",
      attempts: [expect.objectContaining({ issue: "execution_failed" })],
    });
    const select = findRuns.mock.calls[0]?.[0].select;
    expect(select).not.toHaveProperty("checkpoint");
    expect(select).not.toHaveProperty("task");
    expect(select).not.toHaveProperty("sourceMessage");
  });
  it("does not mark historical success blocked after a computer was removed", async () => {
    const { prisma } = fixture([row({ status: "completed", completedAt: at })]);
    expect((await listRunLogs(prisma, actor, {})).runs[0]?.issue).toBeNull();
  });
  it("does not turn a valid text-only computer record into a blocker", async () => {
    const { prisma } = fixture([
      row({ bot: { name: "Text helper", computerId: "none-provider-record" } }),
    ]);
    expect((await listRunLogs(prisma, actor, {})).runs[0]?.issue).toBeNull();
  });
  it("keeps missing data distinct from a completed execution", async () => {
    const { prisma } = fixture([]);
    expect(await listRunLogs(prisma, actor, {})).toMatchObject({ runs: [], nextCursor: null });
  });
  it.each([0, -1, 51, 1.5, Number.POSITIVE_INFINITY])(
    "rejects an invalid page size %s",
    async (limit) => {
      const { prisma, findRuns } = fixture();
      await expect(listRunLogs(prisma, actor, { limit })).rejects.toThrow();
      expect(findRuns).not.toHaveBeenCalled();
    },
  );
  it("rejects invalid cursors before touching the database", () => {
    expect(
      RunLogsInputSchema.safeParse({ before: { id: "run", createdAt: "not-a-date" } }).success,
    ).toBe(false);
  });
});

it.each([
  ["Bot has no computer", "computer_missing"],
  ["Computers unavailable. Set a provider", "computers_disabled"],
  ["This model's context window is too small. Choose another model.", "context_limit"],
  ["rate_limit_exceeded", "rate_limit"],
  ["invalid_api_key", "provider_auth"],
  ["Model unavailable", "model_unavailable"],
  ["unrecognized provider text with secrets", "execution_failed"],
  [null, null],
])("maps only the allowlisted failure category for %s", (error, expected) => {
  expect(runLogIssue(error)).toBe(expected);
});

import type { JobPublisher } from "@mycellios/adapter-kit";
import type { PrismaClient } from "@mycellios/db";
import { describe, expect, it, vi } from "vitest";
import { wakeQueuedMicoRuns } from "./mico-queue-wake.js";

const owner = { botId: "bot-1", spaceId: "space-1", userId: "user-1" };

function setup(status: string, queued: string[] = ["run-2", "run-3"]) {
  const findMany = vi.fn(async () => queued.map((id) => ({ id })));
  const prisma = {
    run: { findUnique: vi.fn(async () => ({ ...owner, status })), findMany },
  } as unknown as PrismaClient;
  const enqueue = vi.fn(async (_job: unknown) => undefined);
  return { prisma, jobs: { enqueue } as unknown as JobPublisher, findMany, enqueue };
}

describe("wakeQueuedMicoRuns", () => {
  it.each(["completed", "failed", "cancelled", "waiting_input"])(
    "continues the Mico's queued runs at once after a %s run frees its slot",
    async (status) => {
      const { prisma, jobs, findMany, enqueue } = setup(status);
      await wakeQueuedMicoRuns({ prisma, jobs }, "run-1");

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ ...owner, id: { not: "run-1" }, status: "queued" }),
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
      );
      expect(enqueue.mock.calls.map(([job]) => job)).toEqual([
        expect.objectContaining({
          name: "run.continue",
          payload: { runId: "run-2" },
          replaceKey: "run:run-2",
          keepExisting: true,
          replaceLockedBefore: expect.any(Date),
        }),
        expect.objectContaining({ payload: { runId: "run-3" }, keepExisting: true }),
      ]);
    },
  );

  it.each(["queued", "leased", "running"])(
    "does nothing while the run still waits for or holds a slot (%s)",
    async (status) => {
      const { prisma, jobs, findMany, enqueue } = setup(status);
      await wakeQueuedMicoRuns({ prisma, jobs }, "run-1");
      expect(findMany).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  it("does nothing for a run that no longer exists", async () => {
    const enqueue = vi.fn();
    const prisma = { run: { findUnique: vi.fn(async () => null) } } as unknown as PrismaClient;
    await wakeQueuedMicoRuns({ prisma, jobs: { enqueue } as unknown as JobPublisher }, "gone");
    expect(enqueue).not.toHaveBeenCalled();
  });
});

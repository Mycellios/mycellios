import type { SandboxProvider } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { selectOfflineCloudWorkspace } from "./offline-cloud-workspace.js";

const run = {
  id: "run", botId: "mico", taskId: "task", threadId: "thread",
  spaceId: "space", userId: "owner", startedAt: null, checkpoint: null, cloudComputerId: null,
};
const lease = { workerId: "worker", fence: 3 };
const desktop = { id: "local", scope: "dedicated", kind: "desktop" };

function fixture(kind: "desktop" | "docker" = "docker") {
  const database = {
    thread: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "thread", taskBotId: null }) },
    task: { findUniqueOrThrow: vi.fn().mockResolvedValue({ resources: [] }) },
    computer: {
      upsert: vi.fn(({ create }) => ({ ...create, id: "cloud" })),
      findFirstOrThrow: vi.fn().mockResolvedValue({ id: "cloud", kind: "docker" }),
    },
    run: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    $transaction: vi.fn(),
  };
  database.$transaction.mockImplementation((action) => action(database));
  const provisionKind = vi.fn().mockResolvedValue(kind);
  const sandbox = { describe: () => ({ id: "docker" }), provisionKind } as unknown as SandboxProvider;
  const prisma = database as unknown as PrismaClient;
  return { database, provisionKind, sandbox, prisma };
}

describe("offline cloud workspaces", () => {
  it("pins a separate durable workspace without replacing the Mico's Desktop assignment", async () => {
    const { database, prisma, sandbox } = fixture();
    const computer = await selectOfflineCloudWorkspace(prisma, sandbox, run, desktop, lease);
    expect(computer).toMatchObject({
      id: "cloud", spaceId: "space", userId: "owner", scope: "dedicated", kind: "docker",
      homeKey: expect.stringMatching(/^cloud-[a-f0-9]{32}$/),
    });
    expect(database.run.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        bot: { archivedAt: null, computerSwitching: false, computerId: "local" },
        leaseOwner: "worker", leaseFence: 3, cloudComputerId: null,
      }),
      data: { cloudComputerId: "cloud" },
    });
  });

  it("resumes the pinned workspace when the PC becomes available", async () => {
    const { database, prisma, sandbox, provisionKind } = fixture("desktop");
    const resumed = { ...run, cloudComputerId: "cloud", startedAt: new Date(), checkpoint: "checkpoint" };
    await expect(selectOfflineCloudWorkspace(prisma, sandbox, resumed, desktop, lease))
      .resolves.toMatchObject({ id: "cloud" });
    expect(database.computer.findFirstOrThrow).toHaveBeenCalledWith({
      where: { id: "cloud", spaceId: "space", userId: "owner", scopeKey: { startsWith: "cloud:" } },
    });
    expect(provisionKind).not.toHaveBeenCalled();
    expect(database.computer.upsert).not.toHaveBeenCalled();
  });

  it("keeps a native project, local resources and an interrupted turn on Desktop", async () => {
    const { database, prisma, sandbox } = fixture();
    database.thread.findUniqueOrThrow.mockResolvedValueOnce({
      id: "thread", taskBotId: "mico", projectKey: "project:local", taskKey: "feature",
    });
    await expect(selectOfflineCloudWorkspace(prisma, sandbox, run, desktop, lease)).resolves.toBeUndefined();
    database.task.findUniqueOrThrow.mockResolvedValueOnce({ resources: ["host"] });
    await expect(selectOfflineCloudWorkspace(prisma, sandbox, run, desktop, lease)).resolves.toBeUndefined();
    await expect(selectOfflineCloudWorkspace(prisma, sandbox, { ...run, checkpoint: "local" }, desktop, lease))
      .resolves.toBeUndefined();
    expect(database.$transaction).not.toHaveBeenCalled();
  });
});

import type { SandboxProvider } from "@mycellios/adapter-kit";
import type { PrismaClient } from "@mycellios/db";
import { describe, expect, it, vi } from "vitest";
import { appendEventInTransaction, createThreadMessageInTransaction } from "@mycellios/db";
import { DesktopUnreachableError } from "./computer-errors.js";
import { desktopRelayAvailable, desktopRelayKey } from "./desktop-relay.js";
import { HostAwareSandbox } from "./host-aware-sandbox.js";
import { OFFLINE_CLOUD_NOTICE, selectOfflineCloudWorkspace } from "./offline-cloud-workspace.js";

vi.mock("@mycellios/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mycellios/db")>()),
  createThreadMessageInTransaction: vi.fn(async () => ({ id: "notice" })),
  appendEventInTransaction: vi.fn(async () => undefined),
}));

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
  it("keeps an assigned isolated computer instead of manufacturing a Desktop/cloud fallback", async () => {
    const { database, prisma, sandbox, provisionKind } = fixture("desktop");
    await expect(selectOfflineCloudWorkspace(prisma, sandbox, run,
      { id: "private-computer", scope: "isolated", kind: "docker" }, lease)).resolves.toBeUndefined();
    expect(provisionKind).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
  });
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
    // The owner chose This PC, so the chat says this message ran on the server.
    const blocks = [{ kind: "meta", text: OFFLINE_CLOUD_NOTICE }];
    expect(createThreadMessageInTransaction).toHaveBeenCalledWith(database, {
      threadId: "thread", botId: "mico", role: "system", blocks,
      clientNonce: "offline-cloud:run", markUnread: false,
    });
    expect(appendEventInTransaction).toHaveBeenCalledWith(database, expect.objectContaining({
      type: "thread.message.created", payload: { messageId: "notice", role: "system", blocks },
    }));
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

  it("retries instead of moving to a server workspace when the PC check gets no answer", async () => {
    const { database, prisma, sandbox, provisionKind } = fixture();
    const unanswered = new DesktopUnreachableError({ cause: new TypeError("fetch failed") });
    provisionKind.mockRejectedValueOnce(unanswered);
    await expect(selectOfflineCloudWorkspace(prisma, sandbox, run, desktop, lease)).rejects.toBe(unanswered);
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("treats its own check timeout as no answer, never as an offline PC", async () => {
    const { database, prisma, sandbox, provisionKind } = fixture();
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const clock = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(AbortSignal.abort(timeout));
    provisionKind.mockImplementationOnce(async ({ signal }: { signal: AbortSignal }) => {
      throw signal.reason;
    });
    const failure = await selectOfflineCloudWorkspace(prisma, sandbox, run, desktop, lease)
      .catch((error: unknown) => error);
    clock.mockRestore();
    expect(failure).toBeInstanceOf(DesktopUnreachableError);
    expect((failure as Error).cause).toBe(timeout);
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("through the real relay check, retries a timeout and moves only on the relay's answer", async () => {
    const { database, prisma } = fixture();
    const kind = (id: string) => ({ describe: () => ({ id }) }) as unknown as SandboxProvider;
    const sandbox = new HostAwareSandbox(kind("docker"), kind("desktop"),
      desktopRelayAvailable("http://relay.invalid/internal", desktopRelayKey("fixture")));
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const relayFetch = vi.fn().mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(new Response(JSON.stringify({ available: false }), { status: 404 }));
    vi.stubGlobal("fetch", relayFetch);
    try {
      await expect(selectOfflineCloudWorkspace(prisma, sandbox, run, desktop, lease))
        .rejects.toBeInstanceOf(DesktopUnreachableError);
      expect(database.$transaction).not.toHaveBeenCalled();
      await expect(selectOfflineCloudWorkspace(prisma, sandbox, run, desktop, lease))
        .resolves.toMatchObject({ id: "cloud" });
      expect(relayFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

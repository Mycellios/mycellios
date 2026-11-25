import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SandboxProvider } from "@mycellios/adapter-kit";
import type { PrismaClient } from "@mycellios/db";
import { describe, expect, it, vi } from "vitest";
import { appendEventInTransaction, createThreadMessageInTransaction } from "@mycellios/db";
import { DesktopUnreachableError } from "./computer-errors.js";
import { desktopRelayAvailable, desktopRelayKey } from "./desktop-relay.js";
import { HostAwareSandbox } from "./host-aware-sandbox.js";
import { OFFLINE_CLOUD_NOTICE, offlineEngineFallbackNotice, selectOfflineCloudWorkspace } from "./offline-cloud-workspace.js";

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

function fixture(kind: "desktop" | "docker" = "docker", presence?: "connected" | "unresolved" | "offline") {
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
  const hostPresence = vi.fn().mockResolvedValue(presence);
  const sandbox = {
    describe: () => ({ id: "docker" }), provisionKind, ...(presence ? { hostPresence } : {}),
  } as unknown as SandboxProvider;
  const prisma = database as unknown as PrismaClient;
  return { database, provisionKind, hostPresence, sandbox, prisma };
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

  it("never moves a Mico to the server while one of the owner's PCs is online", async () => {
    for (const presence of ["unresolved", "connected"] as const) {
      const { database, prisma, sandbox, hostPresence, provisionKind } = fixture("docker", presence);
      await expect(selectOfflineCloudWorkspace(prisma, sandbox, run, desktop, lease)).resolves.toBeUndefined();
      expect(hostPresence).toHaveBeenCalledOnce();
      expect(provisionKind).not.toHaveBeenCalled();
      expect(database.$transaction).not.toHaveBeenCalled();
    }
    const { prisma, sandbox } = fixture("docker", "offline");
    await expect(selectOfflineCloudWorkspace(prisma, sandbox, run, desktop, lease))
      .resolves.toMatchObject({ id: "cloud" });
  });

  it("moves a native-engine Mico only where the server may run native agents for its owner", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "offline-native-grant-"));
    try {
      const codex = { agentEngine: "codex", dataDir };
      const denied = fixture("docker", "offline");
      await expect(selectOfflineCloudWorkspace(denied.prisma, denied.sandbox, run, desktop, lease, codex))
        .resolves.toBeUndefined();
      expect(denied.hostPresence).not.toHaveBeenCalled();
      expect(denied.database.$transaction).not.toHaveBeenCalled();
      const pi = fixture("docker", "offline");
      await expect(selectOfflineCloudWorkspace(pi.prisma, pi.sandbox, run, desktop, lease, { agentEngine: "pi", dataDir }))
        .resolves.toMatchObject({ id: "cloud" });
      await writeFile(path.join(dataDir, "native-agents.json"),
        JSON.stringify({ authorizedScopes: [{ userId: run.userId, spaceId: run.spaceId }] }));
      const granted = fixture("docker", "offline");
      await expect(selectOfflineCloudWorkspace(granted.prisma, granted.sandbox, run, desktop, lease, codex))
        .resolves.toMatchObject({ id: "cloud" });
      await writeFile(path.join(dataDir, "native-agents.json"), "{ unreadable");
      const unreadable = fixture("docker", "offline");
      await expect(selectOfflineCloudWorkspace(unreadable.prisma, unreadable.sandbox, run, desktop, lease, codex))
        .resolves.toBeUndefined();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("answers an offline PC's CLI Mico with its saved model on the server and says so", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "offline-native-fallback-"));
    try {
      const withModel = { agentEngine: "claude", dataDir, piFallback: vi.fn().mockResolvedValue(true) };
      const moved = fixture("docker", "offline");
      vi.mocked(createThreadMessageInTransaction).mockClear();
      await expect(selectOfflineCloudWorkspace(moved.prisma, moved.sandbox, run, desktop, lease, withModel))
        .resolves.toMatchObject({ id: "cloud", piFallback: true });
      const blocks = [{ kind: "meta", text: offlineEngineFallbackNotice("claude") }];
      expect(blocks[0]!.text).toContain("Claude Code");
      expect(createThreadMessageInTransaction).toHaveBeenCalledWith(moved.database, expect.objectContaining({ blocks }));
      // Without a saved or main model the turn keeps the PC's offline message.
      const none = fixture("docker", "offline");
      await expect(selectOfflineCloudWorkspace(none.prisma, none.sandbox, run, desktop, lease,
        { ...withModel, piFallback: vi.fn().mockResolvedValue(false) })).resolves.toBeUndefined();
      expect(none.hostPresence).not.toHaveBeenCalled();
      // A PC that is online keeps its own CLI.
      const online = fixture("docker", "connected");
      await expect(selectOfflineCloudWorkspace(online.prisma, online.sandbox, run, desktop, lease, withModel))
        .resolves.toBeUndefined();
      // A turn already moved resumes on the same fallback, and a granted server runs the CLI itself.
      const resumed = fixture("docker", "offline");
      await expect(selectOfflineCloudWorkspace(resumed.prisma, resumed.sandbox,
        { ...run, cloudComputerId: "cloud", startedAt: new Date() }, desktop, lease, withModel))
        .resolves.toMatchObject({ id: "cloud", piFallback: true });
      await writeFile(path.join(dataDir, "native-agents.json"),
        JSON.stringify({ authorizedScopes: [{ userId: run.userId, spaceId: run.spaceId }] }));
      const granted = fixture("docker", "offline");
      await expect(selectOfflineCloudWorkspace(granted.prisma, granted.sandbox, run, desktop, lease, withModel))
        .resolves.toMatchObject({ id: "cloud", piFallback: false });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

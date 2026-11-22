import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  planThreadDeletion: vi.fn(),
  purgeDueThreadInTransaction: vi.fn(),
  dueThreadDeletions: vi.fn(),
}));
vi.mock("@mycellios/db", async (original) => ({
  ...(await original<object>()),
  planThreadDeletion: db.planThreadDeletion,
  purgeDueThreadInTransaction: db.purgeDueThreadInTransaction,
  dueThreadDeletions: db.dueThreadDeletions,
  runAsSystem: (_reason: string, fn: () => unknown) => fn(),
  runAsTenant: (_tenant: unknown, fn: () => unknown) => fn(),
}));

import { removeNativeThreadSessions } from "./native-agent-runtime.js";
import { PiJsonlSessionRecorder, piSessionBotRoot, piSessionsRoot, removePiThreadSessions } from "./pi-session.js";
import { purgeDeletedThread, reconcileThreadDeletions } from "./thread-deletion.js";

const thread = { id: "side", spaceId: "space", userId: "owner", taskBotId: "mico" };
const tx = { marker: "tx" };
function deps(dataDir?: string) {
  return {
    prisma: { $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)) },
    artifacts: { remove: vi.fn().mockResolvedValue(undefined) },
    dataDir,
  };
}

beforeEach(() => {
  for (const mock of Object.values(db)) mock.mockReset();
});

describe("purgeDeletedThread", () => {
  it("leaves a restored or not yet due conversation alone", async () => {
    const d = deps();
    db.planThreadDeletion.mockResolvedValue(null);
    await expect(purgeDeletedThread(d as never, "side")).resolves.toBe("not_due");
    expect(d.artifacts.remove).not.toHaveBeenCalled();
    expect(d.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("removes Mico output files, then the thread in one transaction, tolerating files already gone", async () => {
    const d = deps();
    const now = new Date("2026-11-22T10:00:20Z");
    const plan = {
      thread,
      runIds: ["run-1"],
      artifacts: [
        { id: "v2", storageKey: "key-v2", botId: null },
        { id: "root", storageKey: "key-root", botId: "helper" },
      ],
    };
    db.planThreadDeletion.mockResolvedValue(plan);
    db.purgeDueThreadInTransaction.mockResolvedValue("purged");
    d.artifacts.remove.mockRejectedValueOnce(Object.assign(new Error("gone"), { code: "ENOENT" }));
    await expect(purgeDeletedThread(d as never, "side", now)).resolves.toBe("purged");
    expect(db.planThreadDeletion).toHaveBeenCalledWith(d.prisma, "side", now);
    expect(d.artifacts.remove.mock.calls.map(([key, context]) => [key, context.spaceId, context.userId, context.botId]))
      .toEqual([["key-v2", "space", "owner", "mico"], ["key-root", "space", "owner", "helper"]]);
    expect(db.purgeDueThreadInTransaction).toHaveBeenCalledWith(tx, plan, now);
    expect(d.artifacts.remove.mock.invocationCallOrder.at(-1)).toBeLessThan(db.purgeDueThreadInTransaction.mock.invocationCallOrder[0]!);
  });

  it("keeps the thread when a file cannot be removed, so a later attempt retries", async () => {
    const d = deps();
    db.planThreadDeletion.mockResolvedValue({ thread, runIds: [], artifacts: [{ id: "a", storageKey: "k", botId: null }] });
    d.artifacts.remove.mockRejectedValue(new Error("storage unavailable"));
    await expect(purgeDeletedThread(d as never, "side")).rejects.toThrow("storage unavailable");
    expect(d.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("reconcileThreadDeletions", () => {
  it("finishes deletes past their undo window and grace period, one failure not stopping the rest", async () => {
    const d = deps();
    const now = new Date("2026-11-22T10:01:00Z");
    db.dueThreadDeletions.mockResolvedValue([thread, { ...thread, id: "other" }]);
    db.planThreadDeletion.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ thread: { ...thread, id: "other" }, runIds: [], artifacts: [] });
    db.purgeDueThreadInTransaction.mockResolvedValue("purged");
    await reconcileThreadDeletions(d as never, now);
    expect(db.dueThreadDeletions).toHaveBeenCalledWith(d.prisma, new Date("2026-11-22T10:00:55Z"));
    expect(db.planThreadDeletion).toHaveBeenCalledTimes(2);
    expect(db.purgeDueThreadInTransaction).toHaveBeenCalledOnce();
  });
});

describe("conversation session files", () => {
  it("removes only the deleted conversation's recorded Pi transcripts", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "mycellios-thread-delete-"));
    const recorder = new PiJsonlSessionRecorder(piSessionsRoot(dataDir), dataDir);
    const start = (threadId: string, runId: string) => recorder.start({
      runId, threadId, botId: "mico", userId: "owner", provider: "p", model: "m",
      thinkingLevel: "off", systemPrompt: "s", initialMessages: [],
    });
    await start("side", "run-a");
    await start("other", "run-b");
    await start("side", "run-c");
    const root = piSessionBotRoot(piSessionsRoot(dataDir), "owner", "mico");
    expect(await readdir(root)).toHaveLength(3);
    await removePiThreadSessions(dataDir, "owner", "mico", "side");
    expect(await readdir(root)).toHaveLength(1);
    await removePiThreadSessions(undefined, "owner", "mico", "side");
    await removePiThreadSessions(dataDir, "owner", "nobody", "side");
  });

  it("removes each native engine's folder for the conversation and nothing else", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "mycellios-native-delete-"));
    const scope = { spaceId: "space", userId: "owner", botId: "mico", threadId: "side" };
    const folder = (threadId: string, engine: string) => path.join(dataDir, "native-agents",
      createHash("sha256").update(JSON.stringify([scope.spaceId, scope.userId, scope.botId, threadId, engine])).digest("hex"));
    for (const engine of ["codex", "claude"]) await mkdir(folder("side", engine), { recursive: true });
    await mkdir(folder("other", "codex"), { recursive: true });
    await removeNativeThreadSessions(dataDir, scope);
    await expect(stat(folder("side", "codex"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(folder("side", "claude"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(folder("other", "codex"))).isDirectory()).toBe(true);
  });
});

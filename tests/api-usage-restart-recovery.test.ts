import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ApiAccessManager } from "../src/coordinator/api-access.js";
import { createCoordinator } from "../src/coordinator/server.js";
import { MeshDatabase } from "../src/storage/database.js";
import { MeshStore } from "../src/storage/store.js";
const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const limits = {
  starterTokens: 100,
  requestsPerMinute: 100,
  maxConcurrent: 20,
  maxActiveKeys: 2
};
const request = {
  model: "free-model",
  messages: [{
    role: "user" as const,
    content: "hello"
  }],
  max_tokens: 1
};
async function accounting(db: MeshDatabase, concurrency = limits.maxConcurrent) {
  const ordinary = new ApiAccessManager(db, {
    ...limits,
    maxConcurrent: concurrency
  });
  const key = await ordinary.createKey("owner", "operator");
  const access = new ApiAccessManager(db, {
    ...limits,
    maxConcurrent: concurrency
  }, {
    [key.id]: [request.model]
  });
  return {
    access,
    key,
    store: new MeshStore(db)
  };
}
async function reserve(fixture: Awaited<ReturnType<typeof accounting>>, id: string, status = "running", failure?: string) {
  const usage = await fixture.access.beginUsage("owner", fixture.key.id, request);
  await fixture.store.createJob({
    id,
    sessionId: "session-" + id,
    model: request.model,
    workloadClass: "interactive",
    deadlineAt: Date.now() + 60_000
  });
  await fixture.store.setJobStatus(id, status as "running" | "queued" | "failed" | "completed", failure);
  await fixture.access.attachJob(usage.id, id, "session-" + id);
  return usage;
}
it("recovers two occupied slots on real coordinator startup without changing account funds or counters", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycellios-api-restart-"));
  cleanup.push(() => rm(root, {
    recursive: true,
    force: true
  }));
  const databasePath = join(root, "coordinator.db");
  const seed = await MeshDatabase.open(databasePath);
  let seedClosed = false;
  cleanup.push(async () => { if (!seedClosed) await seed.close(); });
  const fixture = await accounting(seed, 2);
  const first = await reserve(fixture, "job-first");
  const second = await reserve(fixture, "job-second");
  await expect(fixture.access.beginUsage("owner", fixture.key.id, request)).rejects.toThrow(expect.objectContaining({
    code: "concurrency_limit_exceeded"
  }));
  const before = await fixture.access.getOrCreateAccount("owner");
  await seed.close();
  seedClosed = true;
  const runtime = await createCoordinator({
    host: "127.0.0.1",
    port: 0,
    databasePath,
    requestTimeoutMs: 30_000,
    apiAccessEnabled: true,
    apiMaxConcurrent: 2,
    mobileAssetsPath: resolve("tests/fixtures/mobile-assets"),
    landingAssetsPath: resolve("tests/fixtures/landing-assets")
  }, {
    logger: false
  });
  cleanup.push(async () => await runtime.close());
  const restarted = new ApiAccessManager(runtime.database, {
    ...limits,
    maxConcurrent: 2
  }, {
    [fixture.key.id]: [request.model]
  });
  expect(await restarted.getOrCreateAccount("owner")).toEqual(before);
  for (const id of [first.id, second.id]) expect((await restarted.listUsage("owner")).find(x => x.id === id)).toMatchObject({
    status: "failed",
    errorCode: "coordinator_restarted",
    inputTokens: 0,
    outputTokens: 0
  });
  expect((await restarted.beginUsage("owner", fixture.key.id, request)).reservedTokens).toBe(0);
  expect(await restarted.reconcileRestartedZeroTokenUsage()).toBe(0);
});
it("settles only terminal zero-token restart failures and is idempotent", async () => {
  const db = await MeshDatabase.open(":memory:");
  cleanup.push(async () => await db.close());
  const fixture = await accounting(db);
  const target = await reserve(fixture, "target", "failed", "coordinator_restarted");
  const before = await fixture.access.getOrCreateAccount("owner");
  expect(await fixture.access.reconcileRestartedZeroTokenUsage()).toBe(1);
  expect(await fixture.access.reconcileRestartedZeroTokenUsage()).toBe(0);
  expect(await fixture.access.getOrCreateAccount("owner")).toEqual(before);
  expect((await fixture.access.listUsage("owner")).find(x => x.id === target.id)).toMatchObject({
    status: "failed",
    errorCode: "coordinator_restarted",
    reservedTokens: 0
  });
});
it("preserves live, completed, unlinked, nonzero-token and refund-bearing reservations", async () => {
  const db = await MeshDatabase.open(":memory:");
  cleanup.push(async () => await db.close());
  const fixture = await accounting(db);
  await reserve(fixture, "running");
  await reserve(fixture, "queued", "queued");
  await reserve(fixture, "completed", "completed");
  await reserve(fixture, "other-failure", "failed", "worker_failed");
  await reserve(fixture, "had-input", "failed", "coordinator_restarted");
  await db.raw.prepare("UPDATE jobs SET input_tokens = 1 WHERE id = 'had-input'").run();
  await reserve(fixture, "had-output", "failed", "coordinator_restarted");
  await db.raw.prepare("UPDATE jobs SET output_tokens = 1 WHERE id = 'had-output'").run();
  await fixture.access.beginUsage("owner", fixture.key.id, request);
  const positive = await fixture.access.beginUsage("owner", null, request);
  await fixture.store.createJob({
    id: "positive",
    sessionId: "positive-session",
    model: request.model,
    workloadClass: "interactive",
    deadlineAt: Date.now() + 60_000
  });
  await fixture.store.setJobStatus("positive", "failed", "coordinator_restarted");
  await fixture.access.attachJob(positive.id, "positive", "positive-session");
  expect(positive.reservedTokens).toBeGreaterThan(0);
  const before = await fixture.access.listUsage("owner");
  const account = await fixture.access.getOrCreateAccount("owner");
  expect(await fixture.access.reconcileRestartedZeroTokenUsage()).toBe(0);
  expect(await fixture.access.listUsage("owner")).toEqual(before);
  expect(await fixture.access.getOrCreateAccount("owner")).toEqual(account);
});

import { describe, expect, it, vi } from "vitest";
import { NODE_EVENT_ORIGIN_CURSOR, nodeSnapshotSchema, type NodeSnapshot } from "../src/contracts/node-control.js";
import {
  NODE_AUTO_UPDATE_POLICY,
  NodeAutoUpdateScheduler,
  NodeAutoUpdateStore,
  planNodeAutoUpdate,
  type NodeAutoUpdateInput,
} from "../src/coordinator/node-auto-update.js";
import { NodeCommandStore } from "../src/coordinator/node-command-store.js";
import { MeshDatabase } from "../src/storage/database.js";

const NOW = Date.parse("2026-11-23T10:00:00.000Z");
const TARGET = `sha256:${"a".repeat(64)}` as const;
const OLD = `sha256:${"b".repeat(64)}` as const;

function snapshot(overrides: Partial<NodeSnapshot> = {}): NodeSnapshot {
  return nodeSnapshotSchema.parse({
    schema: "mycellios-node-snapshot/1",
    nodeId: "node-1",
    generation: 3,
    cursor: NODE_EVENT_ORIGIN_CURSOR,
    observedAt: new Date(NOW).toISOString(),
    state: "ready",
    contributionEnabled: true,
    draining: false,
    updateChannel: "stable",
    limits: { maxConcurrency: 1, maxCpuPercent: 80, maxRamMiB: 8_192, maxVramMiB: 6_144, maxDiskMiB: 16_384, maxTemperatureC: 85 },
    activeCommandIds: [],
    build: { version: "0.2.80", sourceRevision: "c".repeat(40) },
    runtime: { ready: true, abi: "mycellios-distribution-runtime/4", backend: "cuda" },
    updates: { capable: true, channel: "stable", platform: "win32", arch: "x64", activeManifestId: OLD, nodeApp: "bundled" },
    ...overrides,
  });
}

function input(overrides: Partial<NodeAutoUpdateInput> = {}): NodeAutoUpdateInput {
  return {
    preferenceAccountId: "owner-a",
    preferenceEnabled: true,
    ownership: { accountId: "owner-a", status: "active", generation: 3 },
    snapshot: snapshot(),
    maintenance: false,
    targetManifestId: TARGET,
    attempts: [],
    now: NOW,
    ...overrides,
  };
}

describe("planNodeAutoUpdate", () => {
  it("queues the exact published manifest for an idle, opted-in owner's node", () => {
    expect(planNodeAutoUpdate(input())).toEqual({ action: "update", manifestId: TARGET });
  });

  it("never applies one account's consent to another owner's node", () => {
    expect(planNodeAutoUpdate(input({ ownership: { accountId: "owner-b", status: "active", generation: 3 } })))
      .toEqual({ action: "skip", reason: "node_owner_mismatch" });
    expect(planNodeAutoUpdate(input({ ownership: { accountId: "owner-a", status: "revoked", generation: 3 } })))
      .toEqual({ action: "skip", reason: "node_not_owned" });
  });

  it("respects owner pause, drain, maintenance and active commands", () => {
    expect(planNodeAutoUpdate(input({ snapshot: snapshot({ contributionEnabled: false }) })).action).toBe("skip");
    expect(planNodeAutoUpdate(input({ snapshot: snapshot({ contributionEnabled: false }) }))).toMatchObject({ reason: "node_paused_by_owner" });
    expect(planNodeAutoUpdate(input({ snapshot: snapshot({ draining: true }) }))).toMatchObject({ reason: "node_draining" });
    expect(planNodeAutoUpdate(input({ maintenance: true }))).toMatchObject({ reason: "node_in_maintenance" });
    expect(planNodeAutoUpdate(input({ snapshot: snapshot({ activeCommandIds: ["7b0c8f3e-58d4-4a3b-9c53-1f6f8e2b9c11"] }) })))
      .toMatchObject({ reason: "node_command_active" });
  });

  it("skips builds without the updater, the stable channel or a release", () => {
    expect(planNodeAutoUpdate(input({ preferenceEnabled: false }))).toMatchObject({ reason: "owner_opt_in_disabled" });
    const { updates: _updates, ...legacy } = snapshot();
    expect(planNodeAutoUpdate(input({ snapshot: legacy as NodeSnapshot }))).toMatchObject({ reason: "node_updater_missing" });
    expect(planNodeAutoUpdate(input({ snapshot: snapshot({ updates: { ...snapshot().updates!, capable: false } }) })))
      .toMatchObject({ reason: "node_updater_not_configured" });
    expect(planNodeAutoUpdate(input({ snapshot: snapshot({ updateChannel: "dev" }) }))).toMatchObject({ reason: "node_channel_not_stable" });
    expect(planNodeAutoUpdate(input({ targetManifestId: null }))).toMatchObject({ reason: "release_unavailable" });
    expect(planNodeAutoUpdate(input({ snapshot: snapshot({ updates: { ...snapshot().updates!, activeManifestId: TARGET } }) })))
      .toMatchObject({ reason: "node_up_to_date" });
  });

  it("waits for a busy node and backs off after failed or rolled-back activations", () => {
    const busy = { manifestId: TARGET, state: "rejected" as const, createdAt: NOW - 60_000, completedAt: NOW - 60_000, errorCode: "node_update_waiting_idle" };
    expect(planNodeAutoUpdate(input({ attempts: [busy] }))).toMatchObject({ reason: "node_busy_backoff" });
    expect(planNodeAutoUpdate(input({ attempts: [{ ...busy, completedAt: NOW - NODE_AUTO_UPDATE_POLICY.busyRetryMs }] })).action).toBe("update");
    expect(planNodeAutoUpdate(input({ attempts: [{ ...busy, state: "queued", completedAt: null }] }))).toMatchObject({ reason: "node_update_pending" });
    const failed = { ...busy, errorCode: "component_update_artifact_sha256_mismatch", completedAt: NOW - 10 * 60_000 };
    expect(planNodeAutoUpdate(input({ attempts: [failed] }))).toMatchObject({ reason: "node_update_backoff" });
    // Applied but still reporting the old manifest: the node rolled back on boot health.
    expect(planNodeAutoUpdate(input({ attempts: [{ ...failed, state: "applied", errorCode: null }] }))).toMatchObject({ reason: "node_update_recently_applied" });
    const old = (hoursAgo: number) => ({ ...failed, completedAt: NOW - hoursAgo * 60 * 60_000 });
    expect(planNodeAutoUpdate(input({ attempts: [old(2), old(3), old(4)] }))).toMatchObject({ reason: "release_failed_on_node" });
    // Busy rejections never exhaust the failure budget.
    expect(planNodeAutoUpdate(input({ attempts: [1, 2, 3, 4].map((h) => ({ ...busy, completedAt: NOW - h * 60 * 60_000 })) })).action).toBe("update");
  });
});

describe("NodeAutoUpdateStore on PostgreSQL", () => {
  function postgresDatabase(selectError: unknown) {
    const exec = vi.fn(async () => undefined);
    const all = vi.fn(async () => {
      if (selectError) throw selectError;
      return [];
    });
    const database = { raw: { dialect: "postgres", exec, prepare: () => ({ all, get: async () => undefined }) } };
    return { database: database as unknown as MeshDatabase, exec };
  }

  it("never runs DDL as the runtime role and stays unavailable while the owner has not created the table", async () => {
    for (const code of ["42P01", "42501"]) {
      const { database, exec } = postgresDatabase(Object.assign(new Error("relation is missing"), { code }));
      const preferences = new NodeAutoUpdateStore(database, () => NOW);
      await expect(preferences.initialize()).resolves.toBe(false);
      expect(preferences.available).toBe(false);
      expect(exec).not.toHaveBeenCalled();
      await expect(preferences.get("owner-a", true)).resolves.toMatchObject({ enabled: false, available: false, updatedAt: null });
      await expect(preferences.set("owner-a", true, true)).rejects.toThrow("node_auto_update_unavailable");
    }
  });

  it("uses the owner-created table and still surfaces unrelated database errors", async () => {
    const ready = postgresDatabase(null);
    const preferences = new NodeAutoUpdateStore(ready.database, () => NOW);
    await expect(preferences.initialize()).resolves.toBe(true);
    expect(preferences.available).toBe(true);
    expect(ready.exec).not.toHaveBeenCalled();
    const broken = postgresDatabase(Object.assign(new Error("connection lost"), { code: "08006" }));
    await expect(new NodeAutoUpdateStore(broken.database).initialize()).rejects.toThrow("connection lost");
  });
});

describe("NodeAutoUpdateScheduler", () => {
  it("stores consent per account and queues an owner-scoped, exact update command once", async () => {
    const database = await MeshDatabase.open(":memory:");
    await insertOwnership(database, "node-1", "owner-a");
    await insertOwnership(database, "node-2", "owner-b");
    const commands = new NodeCommandStore(database, () => NOW);
    const preferences = new NodeAutoUpdateStore(database, () => NOW);
    await preferences.initialize();
    await preferences.initialize();
    expect(await preferences.get("owner-a", true)).toMatchObject({ enabled: false, channel: "stable", updatedAt: null });
    await preferences.set("owner-a", true, true);
    expect(await preferences.get("owner-a", true)).toMatchObject({ enabled: true });
    const targetManifestId = vi.fn(async () => TARGET);
    const scheduler = new NodeAutoUpdateScheduler({
      database, commands, preferences, targetManifestId, maintenance: async () => false, now: () => NOW,
    });

    await expect(scheduler.consider(snapshot())).resolves.toEqual({ action: "update", manifestId: TARGET });
    expect(targetManifestId).toHaveBeenCalledWith({ channel: "stable", platform: "win32", arch: "x64" });
    const [queued] = await commands.pull("node-1", 3);
    expect(queued?.command).toMatchObject({
      type: "update",
      actor: { kind: "account", id: "owner-a", scopes: ["node:update"] },
      payload: { version: 1, channel: "stable", manifestId: TARGET },
    });
    await expect(scheduler.consider(snapshot())).resolves.toMatchObject({ reason: "node_update_pending" });

    // owner-b never opted in; owner-a's consent does not reach node-2.
    await expect(scheduler.consider(snapshot({ nodeId: "node-2" }))).resolves.toMatchObject({ reason: "owner_opt_in_disabled" });
    expect(await commands.pull("node-2", 3)).toEqual([]);

    await preferences.set("owner-a", false, true);
    await expect(scheduler.consider(snapshot())).resolves.toMatchObject({ reason: "owner_opt_in_disabled" });
    await database.close();
  });
});

async function insertOwnership(database: MeshDatabase, nodeId: string, accountId: string): Promise<void> {
  await database.raw.prepare(
    `INSERT INTO node_ownership(identity_kind, identity_id, account_id, credential_fingerprint, status, generation, created_at, updated_at)
     VALUES ('device', ?, ?, ?, 'active', 3, ?, ?)`,
  ).run(nodeId, accountId, `sha256:${nodeId.padEnd(64, "0").slice(0, 64)}`, NOW, NOW);
}

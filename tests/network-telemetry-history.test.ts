import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createCoordinator,
  NETWORK_TELEMETRY_INTERVAL_MS,
  type CoordinatorRuntime,
} from "../src/coordinator/server.js";
import { MeshDatabase } from "../src/storage/database.js";
import { MeshStore, type StoredNetworkTelemetrySample } from "../src/storage/store.js";
import {
  ensureNetworkTelemetryFailedJobs,
  networkTelemetryFailedJobsSchemaSql,
} from "../src/storage/network-telemetry-schema.js";
import type { SqlDriver } from "../src/storage/sql-driver.js";

describe("network telemetry history", () => {
  const directories: string[] = [];
  const runtimes: CoordinatorRuntime[] = [];

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("persists ten-minute network samples across coordinator restarts", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mycellios-network-history-"));
    directories.push(directory);
    const path = join(directory, "mesh.db");
    let database = (await MeshDatabase.open(path));
    let store = new MeshStore(database);
    const sample = telemetrySample({
      capturedAt: 1_800_000,
      connectedNodes: 4,
      onlineNodes: 3,
      offeredVramMb: 98_304,
      freeVramMb: 65_536,
    });
    (await store.recordNetworkTelemetrySample(sample));
    (await database.close());

    database = (await MeshDatabase.open(path));
    store = new MeshStore(database);
    expect((await store.listNetworkTelemetrySamples(0))).toEqual([sample]);
    (await database.close());
  });

  it("adds the failed counter to an existing history and keeps older rows unknown", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mycellios-network-history-"));
    directories.push(directory);
    const path = join(directory, "mesh.db");
    let database = (await MeshDatabase.open(path));
    // A history recorded before failed tasks were measured has no failed_jobs column.
    expect((await database.raw.prepare("PRAGMA table_info(network_telemetry_history)").all())
      .some((column) => column.name === "failed_jobs")).toBe(false);
    (await database.raw.prepare(
      `INSERT INTO network_telemetry_history(
         captured_at, registered_nodes, connected_nodes, online_nodes, browser_nodes,
         active_models, model_replicas, model_pipelines, offered_vram_mb, free_vram_mb,
         inflight_jobs, running_jobs, completed_jobs
       ) VALUES (600000, 4, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 12)`,
    ).run());
    (await database.close());

    database = (await MeshDatabase.open(path));
    let store = new MeshStore(database);
    (await store.recordNetworkTelemetrySample(telemetrySample({
      capturedAt: 1_200_000,
      completedJobs: 15,
      failedJobs: 3,
    })));
    (await database.close());

    database = (await MeshDatabase.open(path));
    store = new MeshStore(database);
    expect((await store.listNetworkTelemetrySamples(0)).map((sample) => ({
      capturedAt: sample.capturedAt,
      completedJobs: sample.completedJobs,
      failedJobs: sample.failedJobs,
    }))).toEqual([
      { capturedAt: 600_000, completedJobs: 12, failedJobs: null },
      { capturedAt: 1_200_000, completedJobs: 15, failedJobs: 3 },
    ]);
    (await database.close());
  });

  it("only inspects PostgreSQL, leaving the additive column to the migration owner", async () => {
    const statements: string[] = [];
    const driver = (present: boolean): SqlDriver => ({
      dialect: "postgres",
      exec: async (sql) => { statements.push(sql); },
      prepare: (sql) => {
        statements.push(sql);
        return {
          get: async () => (present ? { present: 1 } : undefined),
          all: async () => [],
          run: async () => ({ changes: 0 }),
        };
      },
      transaction: async (operation) => await operation(),
      close: async () => {},
    });
    expect(await ensureNetworkTelemetryFailedJobs(driver(false))).toBe(false);
    expect(await ensureNetworkTelemetryFailedJobs(driver(true))).toBe(true);
    expect(statements.every((sql) => /^SELECT/.test(sql.trim()))).toBe(true);
    expect(networkTelemetryFailedJobsSchemaSql)
      .toBe("ALTER TABLE network_telemetry_history ADD COLUMN IF NOT EXISTS failed_jobs BIGINT");
  });

  it("never replaces a measured failed counter with an unknown one", async () => {
    const database = await MeshDatabase.open(":memory:");
    try {
      const store = new MeshStore(database);
      await store.recordNetworkTelemetrySample(telemetrySample({ capturedAt: 600_000, failedJobs: 4 }));
      await store.recordNetworkTelemetrySample(telemetrySample({ capturedAt: 600_000, failedJobs: null }));
      expect((await store.listNetworkTelemetrySamples(0))[0]?.failedJobs).toBe(4);
    } finally {
      await database.close();
    }
  });

  it("returns the newest bounded samples in chronological order", async () => {
    const database = await MeshDatabase.open(":memory:");
    try {
      const store = new MeshStore(database);
      for (const capturedAt of [1_800_000, 600_000, 1_200_000]) {
        await store.recordNetworkTelemetrySample(telemetrySample({ capturedAt }));
      }
      expect((await store.listNetworkTelemetrySamples(0, 2)).map((sample) => sample.capturedAt))
        .toEqual([1_200_000, 1_800_000]);
      expect((await store.listNetworkTelemetrySamples(1_500_000)).map((sample) => sample.capturedAt))
        .toEqual([1_800_000]);
    } finally {
      await database.close();
    }
  });

  it("serves bounded public history and records a current sample", async () => {
    const runtime = await createCoordinator({
      host: "127.0.0.1",
      port: 0,
      databasePath: ":memory:",
      requestTimeoutMs: 1_000,
    }, { logger: false });
    runtimes.push(runtime);
    const now = Date.now();
    (await runtime.store.recordNetworkTelemetrySample(telemetrySample({
      capturedAt: now - 8 * 24 * 60 * 60_000,
      connectedNodes: 99,
    })));
    (await runtime.store.recordNetworkTelemetrySample(telemetrySample({
      capturedAt: now - 60 * 60_000,
      connectedNodes: 2,
      offeredVramMb: 24_576,
    })));

    const response = await runtime.app.inject({
      method: "GET",
      url: "/public/v1/history?range=7d",
    });
    expect(response.statusCode).toBe(200);
    const history = response.json() as {
      intervalMinutes: number;
      retentionDays: number;
      range: string;
      samples: Array<{ capturedAt: string; connectedNodes: number }>;
    };
    expect(history).toMatchObject({
      intervalMinutes: NETWORK_TELEMETRY_INTERVAL_MS / 60_000,
      retentionDays: 90,
      range: "7d",
    });
    expect(history.samples.some((sample) => sample.connectedNodes === 99)).toBe(false);
    expect(history.samples.some((sample) => sample.connectedNodes === 2)).toBe(true);
    expect(history.samples.at(-1)?.capturedAt).toBe(
      new Date(Math.floor(now / NETWORK_TELEMETRY_INTERVAL_MS) * NETWORK_TELEMETRY_INTERVAL_MS)
        .toISOString(),
    );
  });

  it("records network failures but not client cancellations in public history", async () => {
    const runtime = await createCoordinator({
      host: "127.0.0.1",
      port: 0,
      databasePath: ":memory:",
      requestTimeoutMs: 1_000,
    }, { logger: false });
    runtimes.push(runtime);
    const now = Date.now();
    (await runtime.store.recordNetworkTelemetrySample(telemetrySample({
      capturedAt: Math.floor(now / NETWORK_TELEMETRY_INTERVAL_MS) * NETWORK_TELEMETRY_INTERVAL_MS
        - 2 * NETWORK_TELEMETRY_INTERVAL_MS,
      failedJobs: null,
    })));
    const outcomes = [
      ["completed", undefined],
      ["failed", "worker_failed"],
      ["failed", "no_feasible_runtime_pipeline"],
      ["expired", "deadline_exceeded"],
      ["cancelled", "cancelled_by_client"],
    ] as const;
    for (const [index, [status, code]] of outcomes.entries()) {
      const id = `outcome-${index}`;
      (await runtime.store.createJob({
        id,
        sessionId: "history-test",
        model: "test-model",
        workloadClass: "interactive",
        deadlineAt: now + 60_000,
      }));
      (await runtime.store.setJobStatus(id, status, code));
    }

    const response = await runtime.app.inject({ method: "GET", url: "/public/v1/history?range=24h" });
    expect(response.statusCode).toBe(200);
    const history = response.json() as {
      failedJobs: { counts: string[]; excludes: string[]; measuredSince: string | null };
      samples: Array<{ capturedAt: string; completedJobs: number; failedJobs: number | null }>;
    };
    expect(history.failedJobs).toEqual({
      counts: ["failed", "expired"],
      excludes: ["cancelled"],
      measuredSince: history.samples.at(-1)?.capturedAt,
    });
    expect(history.samples.map(({ completedJobs, failedJobs }) => ({ completedJobs, failedJobs })))
      .toEqual([{ completedJobs: 0, failedJobs: null }, { completedJobs: 1, failedJobs: 3 }]);
    expect(JSON.stringify(history)).not.toContain("history-test");
  });

  it("counts completed work beyond the 100 jobs shown in a snapshot", async () => {
    const runtime = await createCoordinator({
      host: "127.0.0.1",
      port: 0,
      databasePath: ":memory:",
      requestTimeoutMs: 1_000,
    }, { logger: false });
    runtimes.push(runtime);
    for (let index = 0; index < 101; index += 1) {
      const id = `completed-${index}`;
      (await runtime.store.createJob({
        id,
        sessionId: "history-test",
        model: "test-model",
        workloadClass: "interactive",
        deadlineAt: Date.now() + 60_000,
      }));
      (await runtime.store.setJobStatus(id, "completed"));
    }

    const response = await runtime.app.inject({ method: "GET", url: "/public/v1/snapshot" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ summary: { completedJobs: 101 } });
    expect((await runtime.store.listJobs(100))).toHaveLength(100);
  });
});

function telemetrySample(
  overrides: Partial<StoredNetworkTelemetrySample>,
): StoredNetworkTelemetrySample {
  return {
    capturedAt: 0,
    registeredNodes: 4,
    connectedNodes: 0,
    onlineNodes: 0,
    browserNodes: 0,
    activeModels: 0,
    modelReplicas: 0,
    modelPipelines: 0,
    offeredVramMb: 0,
    freeVramMb: 0,
    inflightJobs: 0,
    runningJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    ...overrides,
  };
}

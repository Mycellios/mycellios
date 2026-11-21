import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { MeshDatabase } from "../storage/database.js";
import { MeshStore } from "../storage/store.js";
import {
  loadNativeReplicaPlacementConfig,
  NativeReplicaPlacementBroker,
  type ReplicaDemandLedger,
} from "./native-replica-placement.js";

/**
 * Standalone placement broker for deployments where the coordinator image is
 * not promoted automatically. It shares the coordinator's database and reads
 * demand from the durable jobs table instead of in-process MeshService events:
 * a job that failed with `no_capacity` is unserved demand, any other job is
 * served demand. Run exactly one broker (in-process or standalone) per network.
 */
export async function recordJobDemand(
  store: MeshStore,
  ledger: ReplicaDemandLedger,
  models: readonly string[],
  since: number,
): Promise<number> {
  if (models.length === 0) return since;
  const rows = await store.database.raw.prepare(
    `SELECT model, failure_code, created_at FROM jobs
     WHERE created_at > ? AND model IN (${models.map(() => "?").join(", ")})
     ORDER BY created_at`,
  ).all(since, ...models) as Array<{ model: string; failure_code: string | null; created_at: number | string }>;
  let cursor = since;
  for (const row of rows) {
    const at = Number(row.created_at);
    ledger.record(row.model, row.failure_code !== "no_capacity", at);
    cursor = Math.max(cursor, at);
  }
  return cursor;
}

async function main(): Promise<void> {
  const configPath = process.argv[2];
  const urlFile = process.env.MYCELLIOS_DATABASE_URL_FILE;
  if (!configPath || !urlFile) throw new Error("usage: native-replica-placement-runner <config.json> (MYCELLIOS_DATABASE_URL_FILE required)");
  const config = await loadNativeReplicaPlacementConfig(configPath);
  const database = await MeshDatabase.openPostgres(readFileSync(urlFile, "utf8").trim(), process.env.MYCELLIOS_DATABASE_SCHEMA ?? "mycellios");
  const store = new MeshStore(database);
  const log = (level: string) => (message: string) => console.log(JSON.stringify({ level, message, at: new Date().toISOString() }));
  const broker = new NativeReplicaPlacementBroker(store, config, { info: log("info"), warn: log("warn") });
  const models = [...new Set(config.replicas.flatMap(replica => replica.requestModels))];
  // Start from recent history so a restart does not forget current demand.
  let cursor = Date.now() - config.idleMs;
  let stopped = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { stopped = true; });
  while (!stopped) {
    try {
      cursor = await recordJobDemand(store, broker.demand, models, cursor);
      const decision = await broker.tick();
      console.log(JSON.stringify({ level: "debug", decision, at: new Date().toISOString() }));
    } catch (error) {
      log("warn")(`native_replica_placement_tick_failed:${error instanceof Error ? error.message : String(error)}`);
    }
    for (let waited = 0; waited < config.tickMs && !stopped; waited += 1_000) {
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
  }
  await database.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

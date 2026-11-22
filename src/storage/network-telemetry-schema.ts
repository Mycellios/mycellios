import type { SqlDriver } from "./sql-driver.js";

/**
 * Additive PostgreSQL migration for the cumulative failed-task history counter.
 * Apply it with the migration owner; the application role never runs DDL there.
 * Rows recorded before it keep NULL, which the public history reports as unknown.
 */
export const networkTelemetryFailedJobsSchemaSql =
  "ALTER TABLE network_telemetry_history ADD COLUMN IF NOT EXISTS failed_jobs BIGINT";

/**
 * Whether `network_telemetry_history.failed_jobs` is available. SQLite owns its
 * schema locally, so the column is added here, idempotently and without a schema
 * version bump. PostgreSQL is only inspected: until the migration owner applies
 * `networkTelemetryFailedJobsSchemaSql`, history keeps working without failures.
 */
export async function ensureNetworkTelemetryFailedJobs(raw: SqlDriver): Promise<boolean> {
  if (raw.dialect === "postgres") {
    return (await raw.prepare(
      `SELECT 1 AS present FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'network_telemetry_history'
         AND column_name = 'failed_jobs'`,
    ).get()) !== undefined;
  }
  const columns = (await raw.prepare("PRAGMA table_info(network_telemetry_history)").all()) as Array<{ name: unknown }>;
  if (columns.length === 0) return false;
  if (!columns.some((column) => column.name === "failed_jobs")) {
    await raw.exec("ALTER TABLE network_telemetry_history ADD COLUMN failed_jobs INTEGER");
  }
  return true;
}

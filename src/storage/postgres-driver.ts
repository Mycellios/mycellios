import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";
import { postgresBindMarkers, type SqlDriver, type SqlRow, type SqlStatement, type SqlValue } from "./sql-driver.js";

type Connection = postgres.Sql | postgres.TransactionSql;
const LOCK_NAMESPACE = 1297695564;
const LOCK_KEY = 1;

function exactInteger(value: string): number {
  const integer = BigInt(value);
  if (integer > BigInt(Number.MAX_SAFE_INTEGER) || integer < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError("Database integer exceeds the current application's safe number contract");
  }
  return Number(integer);
}

/** Native async transactions on the PostgreSQL database managed by Supabase. */
export class PostgresDriver implements SqlDriver {
  readonly dialect = "postgres" as const;
  private readonly context = new AsyncLocalStorage<postgres.TransactionSql>();
  private readonly sql: postgres.Sql;
  private closed = false;

  constructor(url: string, readonly schema = "mycellios") {
    if (!/^[a-z_][a-z_0-9]*$/.test(schema)) throw new Error("Invalid application database schema");
    let parsed: URL;
    try { parsed = new URL(url); }
    catch { throw new Error("Invalid PostgreSQL connection configuration"); }
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("PostgreSQL URL required");
    this.sql = postgres(url, {
      max: 8,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      connection: {
        application_name: "mycellios-coordinator", extra_float_digits: 3,
        search_path: '"' + schema + '",pg_catalog',
        statement_timeout: 15000,
        idle_in_transaction_session_timeout: 30000,
      },
      types: {
        bigint: postgres.BigInt,
        // SUM(bigint) is numeric in PostgreSQL. Retain exact integers through
        // protocol parsing; reject overflow in the awaited query, never a socket callback.
        exactNumeric: { to: 1700, from: [1700], serialize: String, parse: (value: string) => /^-?\d+$/.test(value) ? BigInt(value) : Number(value) },
      },
      onnotice: () => undefined,
    });
  }

  private connection(): Connection {
    if (this.closed) throw new Error("Database is closed");
    return this.context.getStore() ?? this.sql;
  }

  private async execute(query: string, values: SqlValue[]) {
    // Node SQLite rejects undefined/nonfinite values; do not silently coerce them.
    for (const value of values) {
      if (value === undefined || (typeof value === "number" && !Number.isFinite(value))) throw new Error("Invalid SQL parameter");
    }
    let statement = query;
    if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(statement)) {
      if (/\bON\s+CONFLICT\b/i.test(statement)) throw new Error("Ambiguous INSERT conflict policy");
      statement = statement.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/i, "INSERT INTO").replace(/;\s*$/, "") + " ON CONFLICT DO NOTHING";
    }
    if (/^\s*PRAGMA\b/i.test(statement) || /\bINSERT\s+OR\s+REPLACE\b/i.test(statement)) {
      throw new Error("SQLite-only SQL cannot execute in server PostgreSQL mode");
    }
    // Decimal strings bind to the column's native BIGINT without rounding.
    const parameters = values.map((value) => typeof value === "bigint" ? String(value) : value instanceof Uint8Array ? Buffer.from(value) : value);
    const rows = await this.connection().unsafe(postgresBindMarkers(statement, parameters.length), parameters);
    for (const row of rows) {
      for (const [name, value] of Object.entries(row)) {
        if (typeof value === "bigint") row[name] = exactInteger(String(value));
        else if (typeof value === "number" && !Number.isFinite(value)) throw new RangeError("Non-finite database number");
      }
    }
    return rows;
  }

  async exec(query: string): Promise<void> {
    await this.connection().unsafe(query).simple();
  }

  prepare(query: string): SqlStatement {
    return {
      get: async (...values) => (await this.execute(query, values))[0] as SqlRow | undefined,
      all: async (...values) => Array.from(await this.execute(query, values)) as SqlRow[],
      run: async (...values) => ({ changes: (await this.execute(query, values)).count }),
    };
  }

  async transaction<T>(operation: () => T | Promise<T>): Promise<T> {
    const existing = this.context.getStore();
    if (existing) {
      // A savepoint prevents a caught nested SQL error from poisoning its parent.
      return await existing.savepoint(async (savepoint) => await this.context.run(savepoint, operation)) as T;
    }
    const result = await this.sql.begin(async (transaction) => {
      // Preserve SQLite BEGIN IMMEDIATE's serialization for multi-statement writes.
      // This lock is shared across coordinator instances, not a process-local mutex.
      await transaction`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE},${LOCK_KEY})`;
      return await this.context.run(transaction, operation);
    });
    return result as T;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.sql.end({ timeout: 5 });
  }
}

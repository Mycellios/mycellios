import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseSync } from "node:sqlite";
import type { SqlDriver, SqlRow, SqlStatement } from "./sql-driver.js";

/** Local-only adapter. The server Postgres path never imports node:sqlite. */
export class SqliteDriver implements SqlDriver {
  readonly dialect = "sqlite" as const;
  private readonly context = new AsyncLocalStorage<{ transaction: boolean }>();
  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  private constructor(private readonly database: DatabaseSync) {}

  static async open(path: string): Promise<SqliteDriver> {
    const { DatabaseSync } = await import("node:sqlite");
    return new SqliteDriver(new DatabaseSync(path));
  }

  private async exclusive<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.closed) throw new Error("Database is closed");
    if (this.context.getStore()) return await operation();
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await this.context.run({ transaction: false }, operation); }
    finally { release(); }
  }

  async exec(sql: string): Promise<void> {
    await this.exclusive(() => this.database.exec(sql));
  }

  prepare(sql: string): SqlStatement {
    return {
      get: (...values) => this.exclusive(() => this.database.prepare(sql).get(...values) as SqlRow | undefined),
      all: (...values) => this.exclusive(() => this.database.prepare(sql).all(...values) as SqlRow[]),
      run: (...values) => this.exclusive(() => ({ changes: Number(this.database.prepare(sql).run(...values).changes) })),
    };
  }

  async transaction<T>(operation: () => T | Promise<T>): Promise<T> {
    return await this.exclusive(async () => {
      const context = this.context.getStore()!;
      if (context.transaction) return await operation();
      this.database.exec("BEGIN IMMEDIATE");
      context.transaction = true;
      try {
        const value = await operation();
        this.database.exec("COMMIT");
        return value;
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      } finally { context.transaction = false; }
    });
  }

  async close(): Promise<void> {
    await this.exclusive(() => { this.database.close(); this.closed = true; });
  }
}

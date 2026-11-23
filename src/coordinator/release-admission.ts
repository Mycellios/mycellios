/** Operator-only PostgreSQL barrier. All native job writers share this table. */
import type postgres from "postgres";

const trigger = "mycellios_release_admission_guard";
const body = (revision: string) => `BEGIN IF current_setting('mycellios.release_admission_revision',true)='${revision}' THEN RETURN NULL; END IF; RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='mycellios_release_admission_closed'; END;`;
type Connection = postgres.Sql | postgres.TransactionSql;

export class NativeReleaseAdmission {
  constructor(private readonly sql: postgres.Sql, private readonly schema = "mycellios") {
    if (!/^[a-z_][a-z_0-9]*$/.test(schema)) throw new Error("Invalid release database schema");
  }
  private label(revision: string) {
    if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Exact release revision required");
    return `mycellios-release-admission/1 ${revision}`;
  }
  private async owner(sql: Connection): Promise<string | null> {
    const rows = await sql.unsafe<{ label: string | null; body: string; table_name: string; expected: boolean }[]>(`
      SELECT obj_description(t.oid,'pg_trigger') AS label,p.prosrc AS body,c.relname AS table_name,
        (t.tgtype = 6 AND t.tgenabled = 'O' AND p.proname = $2 AND p.pronamespace = n.oid) AS expected
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE n.nspname=$1 AND c.relname IN ('jobs','deployment_operations') AND t.tgname=$2 AND NOT t.tgisinternal`, [this.schema, trigger]);
    if (!rows.length) return null;
    const current = /^mycellios-release-admission\/1 ([a-f0-9]{40})$/.exec(rows[0]?.label ?? "")?.[1];
    if (!current || rows.length !== 2 || new Set(rows.map(row => row.table_name)).size !== 2
        || rows.some(row => !row.expected || row.label !== this.label(current) || row.body !== body(current))) {
      throw new Error("A different release owns native admission");
    }
    return current;
  }
  private async owned(sql: Connection, revision: string): Promise<boolean> {
    this.label(revision);
    const current = await this.owner(sql);
    if (current !== null && current !== revision) throw new Error("A different release owns native admission");
    return current !== null;
  }
  async transfer(previous: string, candidate: string): Promise<void> {
    this.label(previous);
    const label = this.label(candidate);
    if (previous === candidate) throw new Error("Admission transfer requires two revisions");
    await this.sql.begin(async tx => {
      await tx.unsafe("SET LOCAL lock_timeout = '5s'");
      await tx.unsafe(`LOCK TABLE ${this.schema}.jobs, ${this.schema}.deployment_operations IN SHARE ROW EXCLUSIVE MODE`);
      const current = await this.owner(tx);
      // Re-observing the target after a lost response makes no further changes.
      if (current === candidate) return;
      if (current !== previous) throw new Error("Native admission is not owned by the expected release");
      await tx.unsafe(`CREATE OR REPLACE FUNCTION ${this.schema}.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $guard$${body(candidate)}$guard$`);
      for (const table of ["jobs", "deployment_operations"]) {
        await tx.unsafe(`COMMENT ON TRIGGER ${trigger} ON ${this.schema}.${table} IS '${label}'`);
      }
    });
  }
  async close(revision: string): Promise<void> {
    const label = this.label(revision);
    await this.sql.begin(async tx => {
      // Wait for earlier inserts to commit before installing the common barrier.
      await tx.unsafe(`LOCK TABLE ${this.schema}.jobs, ${this.schema}.deployment_operations IN SHARE ROW EXCLUSIVE MODE`);
      if (await this.owned(tx, revision)) return;
      await tx.unsafe(`CREATE FUNCTION ${this.schema}.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $guard$${body(revision)}$guard$`);
      for (const table of ["jobs", "deployment_operations"]) {
        await tx.unsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON ${this.schema}.${table} FOR EACH STATEMENT EXECUTE FUNCTION ${this.schema}.${trigger}()`);
        await tx.unsafe(`COMMENT ON TRIGGER ${trigger} ON ${this.schema}.${table} IS '${label}'`);
      }
    });
  }
  async status(revision: string) {
    if (!await this.owned(this.sql, revision)) throw new Error("Native admission is not closed");
    const [row] = await this.sql.unsafe<{ active: string; pending: string; reserved: string; operations: string }[]>(`
      SELECT (SELECT count(*) FROM ${this.schema}.jobs WHERE status NOT IN ('completed','failed','cancelled','expired')) AS active,
        (SELECT count(*) FROM ${this.schema}.api_usage WHERE status='pending') AS pending,
        (SELECT count(*) FROM ${this.schema}.economic_credit_holds WHERE status='reserved') AS reserved,
        (SELECT count(*) FROM ${this.schema}.deployment_operations WHERE status='running') AS operations`);
    const active = Number(row!.active), pending = Number(row!.pending), reserved = Number(row!.reserved);
    const operations = Number(row!.operations);
    return { active, pending, reserved, operations, drained: active === 0 && pending === 0 && reserved === 0 && operations === 0 };
  }
  async open(revision: string): Promise<void> {
    this.label(revision);
    await this.sql.begin(async tx => {
      await tx.unsafe(`LOCK TABLE ${this.schema}.jobs, ${this.schema}.deployment_operations IN SHARE ROW EXCLUSIVE MODE`);
      if (!await this.owned(tx, revision)) throw new Error("Native admission barrier missing");
      for (const table of ["jobs", "deployment_operations"]) await tx.unsafe(`DROP TRIGGER ${trigger} ON ${this.schema}.${table}`);
      await tx.unsafe(`DROP FUNCTION ${this.schema}.${trigger}()`);
    });
  }
}

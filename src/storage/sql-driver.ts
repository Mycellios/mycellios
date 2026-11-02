export type SqlValue = string | number | bigint | Uint8Array | null;
export type SqlRow = Record<string, SqlValue>;
export interface SqlRunResult { changes: number; }
export interface SqlStatement {
  get(...values: SqlValue[]): Promise<SqlRow | undefined>;
  all(...values: SqlValue[]): Promise<SqlRow[]>;
  run(...values: SqlValue[]): Promise<SqlRunResult>;
}
export interface SqlDriver {
  readonly dialect: "sqlite" | "postgres";
  exec(sql: string): Promise<void>;
  prepare(sql: string): SqlStatement;
  transaction<T>(operation: () => T | Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Translate bind markers only. Quoted values/comments are never interpolated. */
export function postgresBindMarkers(sql: string, parameters: number): string {
  let result = "", index = 0, bind = 0;
  while (index < sql.length) {
    const char = sql[index]!;
    if (char === "'" || char === '"') {
      const quote = char;
      result += char; index++;
      let closed = false;
      while (index < sql.length) {
        const next = sql[index++]!; result += next;
        if (next !== quote) continue;
        if (sql[index] === quote) { result += sql[index++]!; continue; }
        closed = true; break;
      }
      if (!closed) throw new Error("Unterminated SQL literal or identifier");
    } else if (char === "-" && sql[index + 1] === "-") {
      const end = sql.indexOf("\n", index);
      if (end < 0) { result += sql.slice(index); index = sql.length; }
      else { result += sql.slice(index, end + 1); index = end + 1; }
    } else if (char === "/" && sql[index + 1] === "*") {
      const end = sql.indexOf("*/", index + 2);
      if (end < 0) throw new Error("Unterminated SQL comment");
      result += sql.slice(index, end + 2); index = end + 2;
    } else if (char === "$" && /^\$[a-z_0-9]*\$/i.test(sql.slice(index))) {
      const delimiter = /^\$[a-z_0-9]*\$/i.exec(sql.slice(index))![0];
      const end = sql.indexOf(delimiter, index + delimiter.length);
      if (end < 0) throw new Error("Unterminated SQL dollar literal");
      result += sql.slice(index, end + delimiter.length); index = end + delimiter.length;
    } else {
      result += char === "?" ? "$" + ++bind : char;
      index++;
    }
  }
  if (bind !== parameters) throw new Error("SQL bind count does not match values");
  return result;
}

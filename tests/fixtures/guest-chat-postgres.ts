import { readFileSync } from "node:fs";
import type { Sql } from "postgres";
import { contributionCreditSchemaSql } from "../../src/economy/contribution-credit-wallet.js";
import { expiringPromotionSchemaSql } from "../../src/economy/promotional-credits.js";
import { managedPurchasesSchemaSql } from "../../src/economy/managed-purchases.js";
import { guestChatAccessSql, guestChatSchemaSql } from "../../src/economy/guest-chat-schema.js";

/** Creates an isolated schema with the canonical account/wallet/managed tables plus the guest chat owner SQL. */
export async function createGuestChatSchema(sql: Sql, schema: string, role: string) {
  await sql.unsafe(`CREATE SCHEMA ${schema}`);
  const source = readFileSync(new URL("../../src/storage/database.ts", import.meta.url), "utf8");
  // API admission reads jobs to ignore reservations whose job already ended.
  for (const table of ["workers", "jobs", "economic_contribution_evidence", "economic_accounts", "pricing_policies", "economic_settlements",
    "economic_ledger_entries", "economic_settlement_receipts", "node_ownership", "economic_node_reputation", "api_accounts", "api_keys", "api_usage"]) {
    const ddl = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n      \\);`))?.[0];
    if (!ddl) throw new Error("Missing canonical DDL: " + table);
    await sql.unsafe(`SET search_path TO ${schema}; ` + ddl.replace(/\bINTEGER\b/g, "BIGINT"));
  }
  await sql.unsafe(`SET search_path TO ${schema}; CREATE TABLE schema_meta(version integer); INSERT INTO schema_meta VALUES(33);
    CREATE TABLE api_operator_funded_usage(usage_id text);` + contributionCreditSchemaSql + expiringPromotionSchemaSql
    + managedPurchasesSchemaSql + guestChatSchemaSql);
  await sql.unsafe(`CREATE ROLE ${role} NOLOGIN; GRANT USAGE ON SCHEMA ${schema} TO ${role}; SET search_path TO ${schema}; `
    + guestChatAccessSql(role));
}

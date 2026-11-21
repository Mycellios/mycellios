import type { MeshDatabase } from "../storage/database.js";

/**
 * Who may add a node to the network (specs/node-owner-privacy, D8).
 *
 * - Expulsion: an operator revokes a node's credential with a reason that
 *   starts with NODE_PRIVACY_VIOLATION. Its owner account can no longer enroll
 *   or receive nodes, and that node's credential cannot be recovered.
 * - Sybil limit: an account may own at most `limit` active nodes, unless an
 *   operator override raises it. No limit unless configured, so it can be
 *   switched on together with the overrides for operator accounts.
 * - Unowned cells: a new cell identity that no account enrolled escapes both
 *   rules. With `cellAdmission: "enrolled"`, only enrolled cells, cells the
 *   operator starts with the network token and already admitted cells may
 *   register. Default "open" keeps today's public cells.
 */
export const NODE_PRIVACY_VIOLATION = "node_privacy_violation";

export interface NodeOwnerPolicyOptions {
  limit?: number | null | undefined;
  overrides?: ReadonlyMap<string, number> | undefined;
  cellAdmission?: "open" | "enrolled" | undefined;
}

export class NodeOwnerPolicy {
  constructor(private readonly database: MeshDatabase, private readonly options: NodeOwnerPolicyOptions = {}) {}

  /** Reads MYCELLIOS_NODE_OWNER_LIMIT and MYCELLIOS_NODE_OWNER_LIMIT_OVERRIDES ("account=limit,..."). */
  static fromEnvironment(database: MeshDatabase, environment: NodeJS.ProcessEnv = process.env): NodeOwnerPolicy {
    return new NodeOwnerPolicy(database, nodeOwnerPolicyOptions(environment));
  }

  /** Throws `node_owner_expelled_denied` or `node_owner_limit_denied`. */
  async assertCanAddNode(accountId: string): Promise<void> {
    if (await this.isExpelled(accountId)) throw new Error("node_owner_expelled_denied");
    const limit = this.options.overrides?.get(accountId) ?? this.options.limit;
    if (limit === null || limit === undefined) return;
    const row = (await this.database.raw.prepare(
      "SELECT COUNT(*) AS active FROM node_ownership WHERE account_id = ? AND status = 'active'",
    ).get(accountId)) as { active: number | string } | undefined;
    if (Number(row?.active ?? 0) >= limit) throw new Error("node_owner_limit_denied");
  }

  /** True when a registration for this new, unowned cell identity must be refused. */
  async refusesNewCell(identityId: string, fromOperator: boolean): Promise<boolean> {
    if ((this.options.cellAdmission ?? "open") === "open" || fromOperator) return false;
    if (await this.database.getWorkerAdmissionCredential("cell", identityId)) return false;
    return (await this.database.getNodeOwnership("cell", identityId)) === null;
  }

  async isExpelled(accountId: string): Promise<boolean> {
    const row = await this.database.raw.prepare(
      `SELECT 1 AS expelled FROM node_ownership o
       JOIN worker_admission_credentials c ON c.identity_kind = o.identity_kind AND c.identity_id = o.identity_id
       WHERE o.account_id = ? AND c.status = 'revoked'
         AND substr(c.revocation_reason, 1, ${NODE_PRIVACY_VIOLATION.length}) = ? LIMIT 1`,
    ).get(accountId, NODE_PRIVACY_VIOLATION);
    return Boolean(row);
  }
}

export function isPrivacyViolationRevocation(reason: string | null | undefined): boolean {
  return typeof reason === "string" && reason.startsWith(NODE_PRIVACY_VIOLATION);
}

export function nodeOwnerPolicyOptions(environment: NodeJS.ProcessEnv): NodeOwnerPolicyOptions {
  const limit = positiveInteger(environment.MYCELLIOS_NODE_OWNER_LIMIT, "MYCELLIOS_NODE_OWNER_LIMIT");
  const overrides = new Map<string, number>();
  for (const entry of (environment.MYCELLIOS_NODE_OWNER_LIMIT_OVERRIDES ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const separator = trimmed.lastIndexOf("=");
    const account = trimmed.slice(0, separator).trim();
    const value = positiveInteger(trimmed.slice(separator + 1), "MYCELLIOS_NODE_OWNER_LIMIT_OVERRIDES");
    if (separator <= 0 || !account || value === null) throw new Error("MYCELLIOS_NODE_OWNER_LIMIT_OVERRIDES must be account=limit pairs");
    overrides.set(account, value);
  }
  const cellAdmission = (environment.MYCELLIOS_CELL_ADMISSION ?? "open").trim() || "open";
  if (cellAdmission !== "open" && cellAdmission !== "enrolled") throw new Error("MYCELLIOS_CELL_ADMISSION must be open or enrolled");
  return { limit, overrides, cellAdmission };
}

function positiveInteger(value: string | undefined, name: string): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

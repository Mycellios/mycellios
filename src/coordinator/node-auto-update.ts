import { randomBytes, randomUUID } from "node:crypto";
import {
  nodeAutoUpdatePreferenceSchema,
  nodeCommandResultSchema,
  nodeCommandSchema,
  type NodeAutoUpdatePreference,
  type NodeCommand,
  type NodeSnapshot,
} from "../contracts/node-control.js";
import type { MeshDatabase } from "../storage/database.js";
import type { NodeCommandStore } from "./node-command-store.js";

/**
 * Verified runtime updates for an owner's own nodes (specs/node-runtime-auto-update).
 * The coordinator only queues an exact signed manifest id; the node verifies the
 * signature, hashes and provenance, drains, canaries and rolls back by itself.
 */
export const NODE_AUTO_UPDATE_POLICY = Object.freeze({
  channel: "stable" as const,
  commandTtlMs: 15 * 60_000,
  /** A busy node (active leases) is asked again after this delay. */
  busyRetryMs: 15 * 60_000,
  /** Any other rejection or expiry backs off for this long. */
  failureRetryMs: 60 * 60_000,
  /** Failed attempts per manifest within `failureWindowMs` before giving up. */
  maxFailures: 3,
  failureWindowMs: 24 * 60 * 60_000,
});

export interface NodeUpdateAttempt {
  manifestId: string | null;
  state: "queued" | "delivered" | "applied" | "rejected" | "expired";
  createdAt: number;
  completedAt: number | null;
  errorCode: string | null;
}

export interface NodeAutoUpdateInput {
  /** Account whose standing consent is being applied. */
  preferenceAccountId: string;
  preferenceEnabled: boolean;
  ownership: { accountId: string; status: string; generation: number } | null;
  snapshot: NodeSnapshot;
  maintenance: boolean;
  targetManifestId: string | null;
  attempts: readonly NodeUpdateAttempt[];
  now: number;
}

export type NodeAutoUpdateDecision =
  | { action: "update"; manifestId: `sha256:${string}` }
  | { action: "skip"; reason: string };

export function planNodeAutoUpdate(input: NodeAutoUpdateInput): NodeAutoUpdateDecision {
  const skip = (reason: string): NodeAutoUpdateDecision => ({ action: "skip", reason });
  if (!input.preferenceEnabled) return skip("owner_opt_in_disabled");
  const { ownership, snapshot } = input;
  if (!ownership || ownership.status !== "active") return skip("node_not_owned");
  // Consent never crosses accounts: only the node's current owner can grant it.
  if (ownership.accountId !== input.preferenceAccountId) return skip("node_owner_mismatch");
  if (ownership.generation !== snapshot.generation) return skip("node_generation_mismatch");
  const updates = snapshot.updates;
  if (!updates) return skip("node_updater_missing");
  if (!updates.capable) return skip("node_updater_not_configured");
  if (updates.channel !== NODE_AUTO_UPDATE_POLICY.channel || snapshot.updateChannel !== NODE_AUTO_UPDATE_POLICY.channel) {
    return skip("node_channel_not_stable");
  }
  // An owner pause or drain also pauses automatic updates; they resume with it.
  if (!snapshot.contributionEnabled) return skip("node_paused_by_owner");
  if (snapshot.draining) return skip("node_draining");
  if (input.maintenance) return skip("node_in_maintenance");
  if (snapshot.state !== "ready" || !snapshot.runtime.ready) return skip("node_not_ready");
  if (snapshot.activeCommandIds.length > 0) return skip("node_command_active");
  if (!input.targetManifestId || !/^sha256:[a-f0-9]{64}$/.test(input.targetManifestId)) return skip("release_unavailable");
  if (updates.activeManifestId === input.targetManifestId) return skip("node_up_to_date");
  if (input.attempts.some((attempt) => attempt.state === "queued" || attempt.state === "delivered")) {
    return skip("node_update_pending");
  }
  const forTarget = input.attempts.filter((attempt) => attempt.manifestId === input.targetManifestId);
  // The node still reports another manifest, so an applied attempt for this
  // target was rolled back by boot health: it counts as a failure too.
  const failures = forTarget.filter((attempt) => attempt.state !== "queued" && attempt.state !== "delivered"
    && attempt.errorCode !== "node_update_waiting_idle"
    && input.now - (attempt.completedAt ?? attempt.createdAt) < NODE_AUTO_UPDATE_POLICY.failureWindowMs);
  if (failures.length >= NODE_AUTO_UPDATE_POLICY.maxFailures) return skip("release_failed_on_node");
  for (const attempt of forTarget) {
    const finishedAt = attempt.completedAt ?? attempt.createdAt;
    if (attempt.state === "applied" && input.now - finishedAt < NODE_AUTO_UPDATE_POLICY.failureRetryMs) {
      // Applied but the node still reports the old manifest: its boot-health
      // rollback restored the previous runtime. Do not loop on it.
      return skip("node_update_recently_applied");
    }
    if (attempt.state === "rejected" || attempt.state === "expired") {
      const wait = attempt.errorCode === "node_update_waiting_idle"
        ? NODE_AUTO_UPDATE_POLICY.busyRetryMs
        : NODE_AUTO_UPDATE_POLICY.failureRetryMs;
      if (input.now - finishedAt < wait) return skip(attempt.errorCode === "node_update_waiting_idle" ? "node_busy_backoff" : "node_update_backoff");
    }
  }
  return { action: "update", manifestId: input.targetManifestId as `sha256:${string}` };
}

/**
 * Table of owner consent for automatic node updates. On PostgreSQL the migration owner applies
 * it: the coordinator's runtime role has no CREATE on its schema, so the coordinator never runs
 * this DDL there itself.
 */
export const nodeAutoUpdateSchemaSql = `CREATE TABLE IF NOT EXISTS node_auto_update_preferences (
  account_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
  channel TEXT NOT NULL CHECK(channel IN ('stable')),
  updated_at BIGINT NOT NULL
)`;

/** PostgreSQL codes for a table that is missing or not readable by the runtime role. */
const MISSING_TABLE_CODES = new Set(["42P01", "42501"]);

export class NodeAutoUpdateStore {
  private ready = false;

  constructor(
    private readonly database: MeshDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  /** True once the preferences table exists and is usable. */
  get available(): boolean {
    return this.ready;
  }

  /**
   * SQLite creates the table here. On PostgreSQL this only checks that the migration owner
   * applied `nodeAutoUpdateSchemaSql`; without it automatic updates stay unavailable instead of
   * stopping the coordinator.
   */
  async initialize(): Promise<boolean> {
    if (this.database.raw.dialect === "postgres") {
      try {
        await this.database.raw.prepare("SELECT account_id FROM node_auto_update_preferences LIMIT 1").all();
        this.ready = true;
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        if (typeof code !== "string" || !MISSING_TABLE_CODES.has(code)) throw error;
        this.ready = false;
      }
      return this.ready;
    }
    await this.database.raw.exec(nodeAutoUpdateSchemaSql);
    this.ready = true;
    return true;
  }

  async get(accountId: string, available: boolean): Promise<NodeAutoUpdatePreference> {
    if (!this.ready) {
      return nodeAutoUpdatePreferenceSchema.parse({
        schema: "mycellios-node-auto-update/1",
        enabled: false,
        channel: NODE_AUTO_UPDATE_POLICY.channel,
        available: false,
        updatedAt: null,
      });
    }
    const row = (await this.database.raw.prepare(
      "SELECT enabled, updated_at FROM node_auto_update_preferences WHERE account_id = ?",
    ).get(accountId)) as { enabled: number | boolean; updated_at: number } | undefined;
    return nodeAutoUpdatePreferenceSchema.parse({
      schema: "mycellios-node-auto-update/1",
      enabled: row ? Number(row.enabled) === 1 : false,
      channel: NODE_AUTO_UPDATE_POLICY.channel,
      available,
      updatedAt: row ? new Date(Number(row.updated_at)).toISOString() : null,
    });
  }

  async set(accountId: string, enabled: boolean, available: boolean): Promise<NodeAutoUpdatePreference> {
    if (!this.ready) throw new Error("node_auto_update_unavailable");
    const updatedAt = this.now();
    await this.database.transaction(async () => {
      const existing = await this.database.raw.prepare(
        "SELECT account_id FROM node_auto_update_preferences WHERE account_id = ?",
      ).get(accountId);
      if (existing) {
        await this.database.raw.prepare(
          "UPDATE node_auto_update_preferences SET enabled = ?, channel = ?, updated_at = ? WHERE account_id = ?",
        ).run(enabled ? 1 : 0, NODE_AUTO_UPDATE_POLICY.channel, updatedAt, accountId);
      } else {
        await this.database.raw.prepare(
          "INSERT INTO node_auto_update_preferences(account_id, enabled, channel, updated_at) VALUES (?, ?, ?, ?)",
        ).run(accountId, enabled ? 1 : 0, NODE_AUTO_UPDATE_POLICY.channel, updatedAt);
      }
    });
    return this.get(accountId, available);
  }

  async recentUpdateAttempts(nodeId: string, sinceMs: number): Promise<NodeUpdateAttempt[]> {
    const rows = (await this.database.raw.prepare(
      `SELECT c.command_json, c.state, c.created_at, c.completed_at, r.result_json
       FROM node_commands c LEFT JOIN node_command_results r ON r.command_id = c.id
       WHERE c.node_id = ? AND (c.created_at >= ? OR c.state IN ('queued', 'delivered'))
       ORDER BY c.created_at DESC, c.id DESC LIMIT 100`,
    ).all(nodeId, sinceMs)) as Array<{ command_json: string; state: string; created_at: number; completed_at: number | null; result_json: string | null }>;
    const attempts: NodeUpdateAttempt[] = [];
    for (const row of rows) {
      const command = nodeCommandSchema.parse(JSON.parse(row.command_json));
      if (command.type !== "update") continue;
      const result = row.result_json ? nodeCommandResultSchema.safeParse(JSON.parse(row.result_json)) : null;
      attempts.push({
        manifestId: command.payload.manifestId ?? null,
        state: row.state as NodeUpdateAttempt["state"],
        createdAt: Number(row.created_at),
        completedAt: row.completed_at === null ? null : Number(row.completed_at),
        errorCode: result?.success ? result.data.error?.code ?? null : null,
      });
    }
    return attempts;
  }
}

export interface NodeAutoUpdateSchedulerOptions {
  database: MeshDatabase;
  commands: NodeCommandStore;
  preferences: NodeAutoUpdateStore;
  /** Published signed manifest for a target, or null when none exists. */
  targetManifestId(target: { channel: "stable"; platform: string; arch: string }): Promise<string | null>;
  maintenance(nodeId: string): Promise<boolean>;
  now?: () => number;
}

export class NodeAutoUpdateScheduler {
  private readonly inFlight = new Set<string>();
  private readonly now: () => number;

  constructor(private readonly options: NodeAutoUpdateSchedulerOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Evaluates one reconciled snapshot; queues at most one exact update command. */
  async consider(snapshot: NodeSnapshot): Promise<NodeAutoUpdateDecision> {
    const nodeId = snapshot.nodeId;
    if (this.inFlight.has(nodeId)) return { action: "skip", reason: "node_update_evaluation_active" };
    this.inFlight.add(nodeId);
    try {
      const ownership = await this.options.database.getNodeOwnership("device", nodeId);
      if (!ownership) return { action: "skip", reason: "node_not_owned" };
      const preference = await this.options.preferences.get(ownership.accountId, true);
      if (!preference.enabled) return { action: "skip", reason: "owner_opt_in_disabled" };
      const now = this.now();
      const decision = planNodeAutoUpdate({
        preferenceAccountId: ownership.accountId,
        preferenceEnabled: preference.enabled,
        ownership,
        snapshot,
        maintenance: await this.options.maintenance(nodeId),
        targetManifestId: snapshot.updates
          ? await this.options.targetManifestId({ channel: NODE_AUTO_UPDATE_POLICY.channel, platform: snapshot.updates.platform, arch: snapshot.updates.arch })
          : null,
        attempts: await this.options.preferences.recentUpdateAttempts(nodeId, now - NODE_AUTO_UPDATE_POLICY.failureWindowMs),
        now,
      });
      if (decision.action !== "update") return decision;
      await this.options.commands.enqueue(autoUpdateCommand({
        nodeId,
        ownerAccountId: ownership.accountId,
        generation: ownership.generation,
        manifestId: decision.manifestId,
        now,
      }), ownership.generation);
      return decision;
    } finally {
      this.inFlight.delete(nodeId);
    }
  }
}

/** The command is authored under the owner's standing consent, never an operator scope. */
export function autoUpdateCommand(input: {
  nodeId: string;
  ownerAccountId: string;
  generation: number;
  manifestId: `sha256:${string}`;
  now: number;
}): NodeCommand {
  return nodeCommandSchema.parse({
    schema: "mycellios-node-command/1",
    id: randomUUID(),
    nodeId: input.nodeId,
    actor: { kind: "account", id: input.ownerAccountId, scopes: ["node:update"] },
    generation: input.generation,
    issuedAt: new Date(input.now).toISOString(),
    expiresAt: new Date(input.now + NODE_AUTO_UPDATE_POLICY.commandTtlMs).toISOString(),
    nonce: randomBytes(24).toString("base64url"),
    type: "update",
    payload: { version: 1, channel: NODE_AUTO_UPDATE_POLICY.channel, manifestId: input.manifestId },
  });
}

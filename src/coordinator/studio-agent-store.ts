import { mapAsync } from "../core/async-collections.js";
import { createHash, randomUUID } from "node:crypto";
import type { MeshDatabase } from "../storage/database.js";
import {
  studioAgentConfigurationSchema,
  type StudioAgentConfiguration,
  type StudioAgentRecord,
  type StudioAgentRevision,
  type StudioChannel,
  type StudioChannelDeployment,
} from "../contracts/studio.js";

export class StudioAgentError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 400) {
    super(message);
  }
}

export class StudioAgentStore {
  constructor(private readonly database: MeshDatabase) {}

  async create(input: {
    ownerId: string;
    idempotencyKey: string;
    templateId: StudioAgentRecord["templateId"];
    configuration: StudioAgentConfiguration;
  }): Promise<StudioAgentRecord> {
    return (await this.database.transaction(async () => {
      const existing = (await this.database.raw.prepare(
        "SELECT * FROM studio_agents WHERE owner_id = ? AND create_idempotency_key = ?",
      ).get(input.ownerId, input.idempotencyKey));
      const configuration = studioAgentConfigurationSchema.parse(input.configuration);
      if (existing) {
        const agent = agentFromRow(existing);
        if (agent.templateId !== input.templateId || canonicalJson(agent.configuration) !== canonicalJson(configuration)) throw new StudioAgentError("studio_create_idempotency_conflict", "The creation key was already used for a different draft.", 409);
        return agent;
      }
      const now = Date.now();
      const id = `agt_${randomUUID().replaceAll("-", "")}`;
      (await this.database.raw.prepare(
        `INSERT INTO studio_agents(
           id, owner_id, create_idempotency_key, template_id, status,
           operational_state, draft_version, configuration_json,
           published_revision_id, created_at, updated_at, archived_at
         ) VALUES (?, ?, ?, ?, 'draft', 'draft', 1, ?, NULL, ?, ?, NULL)`,
      ).run(id, input.ownerId, input.idempotencyKey, input.templateId, canonicalJson(configuration), now, now));
      (await this.appendEvent(id, input.ownerId, "agent.created", { templateId: input.templateId }));
      (await this.queueAgent(id));
      return (await this.requireOwned(id, input.ownerId));
    }));
  }

  async list(ownerId: string): Promise<StudioAgentRecord[]> {
    return ((await this.database.raw.prepare(
      "SELECT * FROM studio_agents WHERE owner_id = ? ORDER BY updated_at DESC, id",
    ).all(ownerId)) as unknown[]).map(agentFromRow);
  }

  async get(agentId: string, ownerId: string): Promise<StudioAgentRecord | null> {
    const row = (await this.database.raw.prepare(
      "SELECT * FROM studio_agents WHERE id = ? AND owner_id = ?",
    ).get(agentId, ownerId));
    return row ? agentFromRow(row) : null;
  }

  async update(agentId: string, ownerId: string, expectedVersion: number, next: StudioAgentConfiguration): Promise<StudioAgentRecord> {
    return (await this.database.transaction(async () => {
      const current = (await this.requireOwned(agentId, ownerId));
      if (current.status === "archived") throw new StudioAgentError("studio_agent_archived", "Archived agents cannot be edited.", 409);
      if (current.draftVersion !== expectedVersion) throw new StudioAgentError("studio_agent_version_conflict", "The Studio draft changed in another session.", 409);
      const configuration = studioAgentConfigurationSchema.parse(next);
      const now = Date.now();
      const changed = (await this.database.raw.prepare(
        `UPDATE studio_agents SET configuration_json = ?, draft_version = draft_version + 1,
           status = 'draft', operational_state = 'draft', updated_at = ?
         WHERE id = ? AND owner_id = ? AND draft_version = ?`,
      ).run(canonicalJson(configuration), now, agentId, ownerId, expectedVersion));
      if (Number(changed.changes) !== 1) throw new StudioAgentError("studio_agent_version_conflict", "The Studio draft changed in another session.", 409);
      (await this.appendEvent(agentId, ownerId, "draft.updated", { fromVersion: expectedVersion, toVersion: expectedVersion + 1 }));
      (await this.queueAgent(agentId));
      return (await this.requireOwned(agentId, ownerId));
    }));
  }

  async publish(input: {
    agentId: string;
    ownerId: string;
    expectedVersion: number;
    idempotencyKey: string;
    channels: StudioChannel[];
    hasCapacity: boolean;
  }): Promise<{ agent: StudioAgentRecord; revision: StudioAgentRevision; deployments: StudioChannelDeployment[] }> {
    return (await this.database.transaction(async () => {
      const replayRows = (await this.database.raw.prepare(
        "SELECT * FROM studio_channel_deployments WHERE owner_id = ? AND publish_idempotency_key = ? ORDER BY channel",
      ).all(input.ownerId, input.idempotencyKey)) as unknown[];
      if (replayRows.length > 0) {
        const deployments = replayRows.map(deploymentFromRow);
        const agent = (await this.requireOwned(deployments[0]!.agentId, input.ownerId));
        if (agent.id !== input.agentId || deployments.length !== input.channels.length || deployments.some((item) => !input.channels.includes(item.channel))) {
          throw new StudioAgentError("studio_publish_idempotency_conflict", "The publication key was already used for a different request.", 409);
        }
        return { agent, revision: (await this.requireRevision(deployments[0]!.revisionId, agent.id, input.ownerId)), deployments };
      }
      const agent = (await this.requireOwned(input.agentId, input.ownerId));
      if (agent.status === "archived") throw new StudioAgentError("studio_agent_archived", "Archived agents cannot be published.", 409);
      if (agent.draftVersion !== input.expectedVersion) throw new StudioAgentError("studio_agent_version_conflict", "The Studio draft changed before publication.", 409);
      if (input.channels.length === 0 || new Set(input.channels).size !== input.channels.length) {
        throw new StudioAgentError("studio_publish_channels_invalid", "Choose one or more unique publication channels.");
      }
      const revision = (await this.createRevision(agent));
      const now = Date.now();
      for (const channel of input.channels) {
        (await this.database.raw.prepare(
          `UPDATE studio_channel_deployments SET state = 'revoked', revoked_at = ?, updated_at = ?
           WHERE agent_id = ? AND channel = ? AND revoked_at IS NULL`,
        ).run(now, now, agent.id, channel));
      }
      const state = input.hasCapacity ? "ready" : "waiting_for_capacity";
      const deployments = (await mapAsync(input.channels, async (channel) => {
        const id = `dep_${randomUUID().replaceAll("-", "")}`;
        const publicId = `agent_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
        (await this.database.raw.prepare(
          `INSERT INTO studio_channel_deployments(
             id, agent_id, revision_id, owner_id, channel, state, public_id,
             publish_idempotency_key, created_at, updated_at, revoked_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        ).run(id, agent.id, revision.id, input.ownerId, channel, state, publicId, input.idempotencyKey, now, now));
        return deploymentFromRow((await this.database.raw.prepare("SELECT * FROM studio_channel_deployments WHERE id = ?").get(id))!);
      }));
      (await this.database.raw.prepare(
        `UPDATE studio_agents SET status = 'published', operational_state = ?,
           published_revision_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?`,
      ).run(state, revision.id, now, agent.id, input.ownerId));
      (await this.appendEvent(agent.id, input.ownerId, "agent.published", { revisionId: revision.id, channels: input.channels, state }));
      (await this.queueAgent(agent.id));
      (await this.queueRevision(revision.id));
      for (const deployment of deployments) (await this.queueDeployment(deployment.id));
      return { agent: (await this.requireOwned(agent.id, input.ownerId)), revision, deployments };
    }));
  }

  async archive(agentId: string, ownerId: string): Promise<StudioAgentRecord> {
    return (await this.database.transaction(async () => {
      (await this.requireOwned(agentId, ownerId));
      const now = Date.now();
      (await this.database.raw.prepare(
        "UPDATE studio_channel_deployments SET state = 'revoked', revoked_at = COALESCE(revoked_at, ?), updated_at = ? WHERE agent_id = ? AND owner_id = ? AND revoked_at IS NULL",
      ).run(now, now, agentId, ownerId));
      (await this.database.raw.prepare(
        "UPDATE studio_agents SET status = 'archived', operational_state = 'revoked', archived_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
      ).run(now, now, agentId, ownerId));
      (await this.appendEvent(agentId, ownerId, "agent.archived", {}));
      (await this.queueAgent(agentId));
      for (const deployment of (await this.deployments(agentId, ownerId))) (await this.queueDeployment(deployment.id));
      return (await this.requireOwned(agentId, ownerId));
    }));
  }

  async revisions(agentId: string, ownerId: string): Promise<StudioAgentRevision[]> {
    (await this.requireOwned(agentId, ownerId));
    return ((await this.database.raw.prepare(
      "SELECT * FROM studio_agent_revisions WHERE agent_id = ? AND owner_id = ? ORDER BY revision DESC",
    ).all(agentId, ownerId)) as unknown[]).map(revisionFromRow);
  }

  async deployments(agentId: string, ownerId: string): Promise<StudioChannelDeployment[]> {
    (await this.requireOwned(agentId, ownerId));
    return ((await this.database.raw.prepare(
      "SELECT * FROM studio_channel_deployments WHERE agent_id = ? AND owner_id = ? ORDER BY created_at DESC",
    ).all(agentId, ownerId)) as unknown[]).map(deploymentFromRow);
  }

  async revision(revisionId: string, agentId: string, ownerId: string): Promise<StudioAgentRevision> {
    return (await this.requireRevision(revisionId, agentId, ownerId));
  }

  async deploymentByPublicId(publicId: string, channel?: StudioChannel): Promise<StudioChannelDeployment | null> {
    const row = channel
      ? (await this.database.raw.prepare("SELECT * FROM studio_channel_deployments WHERE public_id = ? AND channel = ? AND revoked_at IS NULL").get(publicId, channel))
      : (await this.database.raw.prepare("SELECT * FROM studio_channel_deployments WHERE public_id = ? AND revoked_at IS NULL").get(publicId));
    return row ? deploymentFromRow(row) : null;
  }

  async revokeDeployment(deploymentId: string, ownerId: string): Promise<StudioChannelDeployment> {
    return (await this.database.transaction(async () => {
      const row = (await this.database.raw.prepare("SELECT * FROM studio_channel_deployments WHERE id = ? AND owner_id = ?").get(deploymentId, ownerId));
      if (!row) throw new StudioAgentError("studio_deployment_not_found", "Studio deployment not found.", 404);
      const current = deploymentFromRow(row);
      if (!current.revokedAt) {
        const now = Date.now();
        (await this.database.raw.prepare("UPDATE studio_channel_deployments SET state = 'revoked', revoked_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?").run(now, now, deploymentId, ownerId));
        (await this.appendEvent(current.agentId, ownerId, "deployment.revoked", { deploymentId }));
        (await this.queueDeployment(deploymentId));
      }
      return deploymentFromRow((await this.database.raw.prepare("SELECT * FROM studio_channel_deployments WHERE id = ?").get(deploymentId))!);
    }));
  }

  async rollback(input: { agentId: string; ownerId: string; revisionId: string; idempotencyKey: string; channels: StudioChannel[]; hasCapacity: boolean }): Promise<{ agent: StudioAgentRecord; revision: StudioAgentRevision; deployments: StudioChannelDeployment[] }> {
    return (await this.database.transaction(async () => {
      const agent = (await this.requireOwned(input.agentId, input.ownerId));
      if (agent.status === "archived") throw new StudioAgentError("studio_agent_archived", "Archived agents cannot be rolled back.", 409);
      const revision = (await this.requireRevision(input.revisionId, agent.id, input.ownerId));
      const replay = (await this.database.raw.prepare("SELECT * FROM studio_channel_deployments WHERE owner_id = ? AND publish_idempotency_key = ? ORDER BY channel").all(input.ownerId, input.idempotencyKey)) as unknown[];
      if (replay.length) {
        const deployments = replay.map(deploymentFromRow);
        if (deployments.some((item) => item.agentId !== agent.id || item.revisionId !== revision.id || !input.channels.includes(item.channel)) || deployments.length !== input.channels.length) throw new StudioAgentError("studio_publish_idempotency_conflict", "Rollback key was already used for another request.", 409);
        return { agent: (await this.requireOwned(agent.id, input.ownerId)), revision, deployments };
      }
      if (!input.channels.length || new Set(input.channels).size !== input.channels.length) throw new StudioAgentError("studio_publish_channels_invalid", "Choose unique rollback channels.");
      const now = Date.now();
      const state = input.hasCapacity ? "ready" : "waiting_for_capacity";
      for (const channel of input.channels) (await this.database.raw.prepare("UPDATE studio_channel_deployments SET state = 'revoked', revoked_at = ?, updated_at = ? WHERE agent_id = ? AND channel = ? AND revoked_at IS NULL").run(now, now, agent.id, channel));
      const deployments = (await mapAsync(input.channels, async (channel) => {
        const id = `dep_${randomUUID().replaceAll("-", "")}`;
        (await this.database.raw.prepare("INSERT INTO studio_channel_deployments(id, agent_id, revision_id, owner_id, channel, state, public_id, publish_idempotency_key, created_at, updated_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)").run(id, agent.id, revision.id, input.ownerId, channel, state, `agent_${randomUUID().replaceAll("-", "").slice(0, 24)}`, input.idempotencyKey, now, now));
        (await this.queueDeployment(id));
        return deploymentFromRow((await this.database.raw.prepare("SELECT * FROM studio_channel_deployments WHERE id = ?").get(id))!);
      }));
      (await this.database.raw.prepare("UPDATE studio_agents SET status = 'published', operational_state = ?, published_revision_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?").run(state, revision.id, now, agent.id, input.ownerId));
      (await this.appendEvent(agent.id, input.ownerId, "agent.rolled_back", { revisionId: revision.id, channels: input.channels, state }));
      (await this.queueAgent(agent.id));
      return { agent: (await this.requireOwned(agent.id, input.ownerId)), revision, deployments };
    }));
  }

  async activateCompatibleWaiting(modelId: string): Promise<number> {
    return (await this.database.transaction(async () => {
      const rows = (await this.database.raw.prepare(`SELECT d.id, d.agent_id, d.owner_id FROM studio_channel_deployments d
        JOIN studio_agent_revisions r ON r.id = d.revision_id
        WHERE d.state = 'waiting_for_capacity' AND d.revoked_at IS NULL
        AND ${this.database.raw.dialect === "postgres" ? "(r.configuration_json::jsonb #>> '{modelPolicy,preferredModel}')" : "json_extract(r.configuration_json, '$.modelPolicy.preferredModel')"} = ?`).all(modelId)) as Array<{ id: string; agent_id: string; owner_id: string }>;
      const now = Date.now();
      for (const row of rows) {
        (await this.database.raw.prepare("UPDATE studio_channel_deployments SET state = 'ready', updated_at = ? WHERE id = ? AND state = 'waiting_for_capacity'").run(now, row.id));
        (await this.database.raw.prepare("UPDATE studio_agents SET operational_state = 'ready', updated_at = ? WHERE id = ? AND owner_id = ? AND operational_state = 'waiting_for_capacity'").run(now, row.agent_id, row.owner_id));
        (await this.appendEvent(row.agent_id, row.owner_id, "deployment.ready", { deploymentId: row.id, modelId }));
        (await this.queueDeployment(row.id)); (await this.queueAgent(row.agent_id));
      }
      return rows.length;
    }));
  }

  private async createRevision(agent: StudioAgentRecord): Promise<StudioAgentRevision> {
    const configurationJson = canonicalJson(agent.configuration);
    const digest = createHash("sha256").update("mycellios-studio-revision/1\0").update(configurationJson).digest("hex");
    const existing = (await this.database.raw.prepare(
      "SELECT * FROM studio_agent_revisions WHERE agent_id = ? AND configuration_digest = ?",
    ).get(agent.id, digest));
    if (existing) return revisionFromRow(existing);
    const next = (await this.database.raw.prepare(
      "SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM studio_agent_revisions WHERE agent_id = ?",
    ).get(agent.id)) as { revision: number };
    const id = `rev_${randomUUID().replaceAll("-", "")}`;
    const createdAt = Date.now();
    (await this.database.raw.prepare(
      `INSERT INTO studio_agent_revisions(id, agent_id, owner_id, revision, configuration_json,
         configuration_digest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, agent.id, agent.ownerId, Number(next.revision), configurationJson, digest, createdAt));
    return (await this.requireRevision(id, agent.id, agent.ownerId));
  }

  private async requireOwned(agentId: string, ownerId: string): Promise<StudioAgentRecord> {
    const agent = (await this.get(agentId, ownerId));
    if (!agent) throw new StudioAgentError("studio_agent_not_found", "Studio agent not found.", 404);
    return agent;
  }

  private async requireRevision(revisionId: string, agentId: string, ownerId: string): Promise<StudioAgentRevision> {
    const row = (await this.database.raw.prepare(
      "SELECT * FROM studio_agent_revisions WHERE id = ? AND agent_id = ? AND owner_id = ?",
    ).get(revisionId, agentId, ownerId));
    if (!row) throw new StudioAgentError("studio_revision_not_found", "Studio revision not found.", 404);
    return revisionFromRow(row);
  }

  private async appendEvent(agentId: string, ownerId: string, eventType: string, details: Record<string, unknown>): Promise<void> {
    const previous = (await this.database.raw.prepare(
      "SELECT event_digest FROM studio_agent_events WHERE agent_id = ? ORDER BY sequence DESC LIMIT 1",
    ).get(agentId)) as { event_digest: string } | undefined;
    const occurredAt = Date.now();
    const detailsJson = canonicalJson(details);
    const digest = createHash("sha256")
      .update("mycellios-studio-event/1\0")
      .update(previous?.event_digest ?? "genesis").update("\0")
      .update(agentId).update("\0").update(ownerId).update("\0")
      .update(eventType).update("\0").update(detailsJson).update("\0").update(String(occurredAt))
      .digest("hex");
    (await this.database.raw.prepare(
      `INSERT INTO studio_agent_events(agent_id, owner_id, event_type, details_json,
         previous_event_digest, event_digest, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(agentId, ownerId, eventType, detailsJson, previous?.event_digest ?? null, digest, occurredAt));
    (await this.database.enqueueRemoteChange("studio_agent_events", digest, "upsert", {
      event_digest: digest, sequence: Number(((await this.database.raw.prepare("SELECT sequence FROM studio_agent_events WHERE event_digest = ?").get(digest)) as { sequence: number }).sequence),
      agent_id: agentId, owner_id: ownerId, event_type: eventType, details,
      previous_event_digest: previous?.event_digest ?? null, occurred_at: new Date(occurredAt).toISOString(),
    }));
  }

  private async queueAgent(agentId: string): Promise<void> {
    const row = (await this.database.raw.prepare("SELECT * FROM studio_agents WHERE id = ?").get(agentId)) as Record<string, unknown> | undefined;
    if (!row) return;
    (await this.database.enqueueRemoteChange("studio_agents", agentId, "upsert", {
      id: row.id, owner_id: row.owner_id, create_idempotency_key: row.create_idempotency_key,
      template_id: row.template_id, status: row.status, operational_state: row.operational_state,
      draft_version: Number(row.draft_version), configuration: JSON.parse(String(row.configuration_json)),
      published_revision_id: row.published_revision_id,
      created_at: new Date(Number(row.created_at)).toISOString(), updated_at: new Date(Number(row.updated_at)).toISOString(),
      archived_at: row.archived_at === null ? null : new Date(Number(row.archived_at)).toISOString(),
    }));
  }

  private async queueRevision(revisionId: string): Promise<void> {
    const row = (await this.database.raw.prepare("SELECT * FROM studio_agent_revisions WHERE id = ?").get(revisionId)) as Record<string, unknown> | undefined;
    if (!row) return;
    (await this.database.enqueueRemoteChange("studio_agent_revisions", revisionId, "upsert", {
      id: row.id, agent_id: row.agent_id, owner_id: row.owner_id, revision: Number(row.revision),
      configuration: JSON.parse(String(row.configuration_json)), configuration_digest: row.configuration_digest,
      created_at: new Date(Number(row.created_at)).toISOString(),
    }));
  }

  private async queueDeployment(deploymentId: string): Promise<void> {
    const row = (await this.database.raw.prepare("SELECT * FROM studio_channel_deployments WHERE id = ?").get(deploymentId)) as Record<string, unknown> | undefined;
    if (!row) return;
    (await this.database.enqueueRemoteChange("studio_channel_deployments", deploymentId, "upsert", {
      id: row.id, agent_id: row.agent_id, revision_id: row.revision_id, owner_id: row.owner_id,
      channel: row.channel, state: row.state, public_id: row.public_id, publish_idempotency_key: row.publish_idempotency_key,
      created_at: new Date(Number(row.created_at)).toISOString(), updated_at: new Date(Number(row.updated_at)).toISOString(),
      revoked_at: row.revoked_at === null ? null : new Date(Number(row.revoked_at)).toISOString(),
    }));
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortValue(item)]));
}

function agentFromRow(source: unknown): StudioAgentRecord {
  const row = source as Record<string, unknown>;
  return {
    id: String(row.id), ownerId: String(row.owner_id),
    templateId: row.template_id as StudioAgentRecord["templateId"],
    status: row.status as StudioAgentRecord["status"],
    operationalState: row.operational_state as StudioAgentRecord["operationalState"],
    draftVersion: Number(row.draft_version),
    configuration: studioAgentConfigurationSchema.parse(JSON.parse(String(row.configuration_json))),
    publishedRevisionId: row.published_revision_id === null ? null : String(row.published_revision_id),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    archivedAt: row.archived_at === null ? null : Number(row.archived_at),
  };
}

function revisionFromRow(source: unknown): StudioAgentRevision {
  const row = source as Record<string, unknown>;
  return {
    id: String(row.id), agentId: String(row.agent_id), ownerId: String(row.owner_id),
    revision: Number(row.revision), configuration: studioAgentConfigurationSchema.parse(JSON.parse(String(row.configuration_json))),
    digest: String(row.configuration_digest), createdAt: Number(row.created_at),
  };
}

function deploymentFromRow(source: unknown): StudioChannelDeployment {
  const row = source as Record<string, unknown>;
  return {
    id: String(row.id), agentId: String(row.agent_id), revisionId: String(row.revision_id), ownerId: String(row.owner_id),
    channel: row.channel as StudioChannelDeployment["channel"], state: row.state as StudioChannelDeployment["state"],
    publicId: String(row.public_id), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
  };
}

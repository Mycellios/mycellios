import { describe, expect, it } from "vitest";
import { MeshDatabase } from "../src/storage/database.js";
import { StudioAgentError, StudioAgentStore } from "../src/coordinator/studio-agent-store.js";

const configuration = {
  name: "Mara", role: "Product guide",
  instructions: "Explain Mycellios accurately and state uncertainty whenever evidence is unavailable.",
  memoryMode: "approved" as const, knowledgeSourceIds: [], tools: ["documents" as const],
  modelPolicy: { preferredModel: "Qwen/Qwen3-0.6B", fallbackModel: null, privacy: "trusted-only" as const, maxOutputTokens: 512, deadlineMs: 120_000 },
};

async function fixture() {
  const database = (await MeshDatabase.open(":memory:"));
  return { database, store: new StudioAgentStore(database) };
}

describe("StudioAgentStore", () => {
  it("creates idempotently and isolates owners", async () => {
    const { database, store } = (await fixture());
    const created = (await store.create({ ownerId: "owner-a", idempotencyKey: "create-1", templateId: "concierge", configuration }));
    expect((await store.create({ ownerId: "owner-a", idempotencyKey: "create-1", templateId: "concierge", configuration })).id).toBe(created.id);
    await expect((async () => (await store.create({ ownerId: "owner-a", idempotencyKey: "create-1", templateId: "concierge", configuration: { ...configuration, name: "Different" } })))()).rejects.toThrow(/different draft/i);
    expect((await store.list("owner-b"))).toEqual([]);
    expect((await store.get(created.id, "owner-b"))).toBeNull();
    (await database.close());
  });

  it("uses optimistic draft versions", async () => {
    const { database, store } = (await fixture());
    const created = (await store.create({ ownerId: "owner-a", idempotencyKey: "create-1", templateId: null, configuration }));
    const updated = (await store.update(created.id, "owner-a", 1, { ...configuration, name: "Aster" }));
    expect(updated.draftVersion).toBe(2);
    await expect((async () => (await store.update(created.id, "owner-a", 1, configuration)))()).rejects.toThrowError(StudioAgentError);
    (await database.close());
  });

  it("publishes an immutable revision while capacity is absent", async () => {
    const { database, store } = (await fixture());
    const created = (await store.create({ ownerId: "owner-a", idempotencyKey: "create-1", templateId: "concierge", configuration }));
    const published = (await store.publish({ agentId: created.id, ownerId: "owner-a", expectedVersion: 1, idempotencyKey: "publish-1", channels: ["web", "api"], hasCapacity: false }));
    expect(published.agent.operationalState).toBe("waiting_for_capacity");
    expect(published.deployments.map((item) => item.state)).toEqual(["waiting_for_capacity", "waiting_for_capacity"]);
    expect((await store.publish({ agentId: created.id, ownerId: "owner-a", expectedVersion: 1, idempotencyKey: "publish-1", channels: ["web", "api"], hasCapacity: true })).revision.id).toBe(published.revision.id);
    await expect((async () => (await store.publish({ agentId: created.id, ownerId: "owner-a", expectedVersion: 1, idempotencyKey: "publish-1", channels: ["web", "telegram"], hasCapacity: true })))()).rejects.toThrow(/different request/i);
    await expect((async () => (await database.raw.prepare("UPDATE studio_agent_revisions SET revision = 9").run()))()).rejects.toThrow(/immutable_studio_agent_revision/);
    (await database.close());
  });

  it("revokes channels when the agent is archived", async () => {
    const { database, store } = (await fixture());
    const created = (await store.create({ ownerId: "owner-a", idempotencyKey: "create-1", templateId: null, configuration }));
    (await store.publish({ agentId: created.id, ownerId: "owner-a", expectedVersion: 1, idempotencyKey: "publish-1", channels: ["web"], hasCapacity: false }));
    expect((await store.archive(created.id, "owner-a")).operationalState).toBe("revoked");
    expect((await store.deployments(created.id, "owner-a"))[0]?.state).toBe("revoked");
    (await database.close());
  });

  it("rolls back by redeploying an exact immutable revision idempotently", async () => {
    const { database, store } = (await fixture());
    const created = (await store.create({ ownerId: "owner-a", idempotencyKey: "create-1", templateId: null, configuration }));
    const first = (await store.publish({ agentId: created.id, ownerId: "owner-a", expectedVersion: 1, idempotencyKey: "publish-1", channels: ["web"], hasCapacity: false }));
    (await store.update(created.id, "owner-a", 1, { ...configuration, name: "Changed" }));
    (await store.publish({ agentId: created.id, ownerId: "owner-a", expectedVersion: 2, idempotencyKey: "publish-2", channels: ["web"], hasCapacity: false }));
    const rollback = (await store.rollback({ agentId: created.id, ownerId: "owner-a", revisionId: first.revision.id, idempotencyKey: "rollback-1", channels: ["web"], hasCapacity: false }));
    expect(rollback.agent.publishedRevisionId).toBe(first.revision.id);
    expect(rollback.deployments[0]?.revisionId).toBe(first.revision.id);
    expect((await store.rollback({ agentId: created.id, ownerId: "owner-a", revisionId: first.revision.id, idempotencyKey: "rollback-1", channels: ["web"], hasCapacity: true })).deployments[0]?.id).toBe(rollback.deployments[0]?.id);
    (await database.close());
  });
});

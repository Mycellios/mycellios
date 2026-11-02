import { describe, expect, it } from "vitest";
import { NodeOwnershipTransferStore } from "../src/coordinator/node-ownership-transfer-store.js";
import { MeshDatabase } from "../src/storage/database.js";

describe("node ownership transfer store", () => {
  it("requires target possession of the one-time token and rotates ownership atomically", async () => {
    const database = (await fixture());
    const store = new NodeOwnershipTransferStore(database, () => 1_000_000);
    const transfer = (await store.create({ nodeId: "node-1", sourceAccountId: "owner-a", targetAccountId: "owner-b", expectedGeneration: 1, expiresInSeconds: 900 }));
    expect(async () => (await store.accept({ transferId: transfer.transferId, transferToken: "wrong-token-that-is-long-enough-000", targetAccountId: "owner-b", nodeId: "node-1" }))).toThrow("node_transfer_token_mismatch");
    expect((await store.accept({ transferId: transfer.transferId, transferToken: transfer.transferToken, targetAccountId: "owner-b", nodeId: "node-1" }))).toEqual({ state: "transferred", nodeId: "node-1", generation: 2 });
    expect((await database.getNodeOwnership("device", "node-1"))).toMatchObject({ accountId: "owner-b", generation: 2, status: "active" });
    expect((await database.nodeIdentityEvents("device", "node-1")).map(({ eventType }) => eventType)).toEqual([
      "identity.enrolled", "ownership.transfer_requested", "ownership.transferred",
    ]);
    expect(async () => (await store.accept({ transferId: transfer.transferId, transferToken: transfer.transferToken, targetAccountId: "owner-b", nodeId: "node-1" }))).toThrow("node_transfer_already_accepted");
    (await database.close());
  });

  it("rejects expiry, self-transfer and stale generations", async () => {
    let now = 1_000_000;
    const database = (await fixture());
    const store = new NodeOwnershipTransferStore(database, () => now);
    expect(async () => (await store.create({ nodeId: "node-1", sourceAccountId: "owner-a", targetAccountId: "owner-a", expectedGeneration: 1, expiresInSeconds: 300 }))).toThrow("node_transfer_target_is_current_owner");
    expect(async () => (await store.create({ nodeId: "node-1", sourceAccountId: "owner-a", targetAccountId: "owner-b", expectedGeneration: 2, expiresInSeconds: 300 }))).toThrow("node_transfer_generation_conflict");
    const transfer = (await store.create({ nodeId: "node-1", sourceAccountId: "owner-a", targetAccountId: "owner-b", expectedGeneration: 1, expiresInSeconds: 300 }));
    now += 300_001;
    expect(async () => (await store.accept({ transferId: transfer.transferId, transferToken: transfer.transferToken, targetAccountId: "owner-b", nodeId: "node-1" }))).toThrow("node_transfer_expired");
    (await database.close());
  });
});

async function fixture(): Promise<MeshDatabase> {
  const database = (await MeshDatabase.open(":memory:"));
  (await database.raw.prepare(`INSERT INTO node_ownership(identity_kind, identity_id, account_id, credential_fingerprint, status, generation, created_at, updated_at) VALUES ('device', 'node-1', 'owner-a', ?, 'active', 1, 1, 1)`).run(`sha256:${"a".repeat(64)}`));
  (await database.appendNodeIdentityEvent({ identityKind: "device", identityId: "node-1", generation: 1,
    actorKind: "account", actorId: "owner-a", eventType: "identity.enrolled", details: {} }));
  return database;
}

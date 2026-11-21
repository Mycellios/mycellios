import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { workerConfigSchema } from "../src/contracts/schemas.js";
import type { WorkerCapabilities } from "../src/contracts/types.js";
import { NodeEnrollmentStore } from "../src/coordinator/node-enrollment-store.js";
import { NodeOwnerPolicy, nodeOwnerPolicyOptions } from "../src/coordinator/node-owner-policy.js";
import { NodeOwnershipTransferStore } from "../src/coordinator/node-ownership-transfer-store.js";
import { createCoordinator, type CoordinatorRuntime } from "../src/coordinator/server.js";
import { WorkerAdmissionAuthority } from "../src/coordinator/worker-admission.js";
import { workerRegistrationDigest } from "../src/core/worker-admission-digest.js";
import { MeshDatabase } from "../src/storage/database.js";
import { generateWorkerAdmissionCredential, workerAdmissionSigner } from "../src/worker/admission-credential.js";

const databases: MeshDatabase[] = [];
const runtimes: CoordinatorRuntime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const database of databases.splice(0)) await database.close();
  delete process.env.MYCELLIOS_CELL_ADMISSION;
});

async function database(): Promise<MeshDatabase> {
  const opened = await MeshDatabase.open(":memory:");
  databases.push(opened);
  return opened;
}

async function own(db: MeshDatabase, identityId: string, accountId: string, kind: "device" | "cell" = "device"): Promise<void> {
  const now = Date.now();
  await db.raw.prepare(
    `INSERT INTO node_ownership(identity_kind, identity_id, account_id, credential_fingerprint,
     status, generation, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 1, ?, ?)`,
  ).run(kind, identityId, accountId, `sha256:${identityId.padEnd(64, "0").slice(0, 64)}`, now, now);
}

async function credential(db: MeshDatabase, identityId: string, status: "active" | "revoked", reason: string | null,
  kind: "device" | "cell" = "device"): Promise<void> {
  const now = Date.now();
  await db.raw.prepare(
    `INSERT INTO worker_admission_credentials(identity_kind, identity_id, algorithm, public_key, fingerprint,
     status, protocol_version, created_at, updated_at, last_seen_at, revoked_at, revocation_reason)
     VALUES (?, ?, 'ed25519', ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
  ).run(kind, identityId, `key-${identityId}`, `sha256:${identityId}`, status, now, now, now, status === "revoked" ? now : null, reason);
}

describe("node owner policy (specs/node-owner-privacy D8)", () => {
  it("reads the limit, the overrides and the cell admission mode from the environment", () => {
    expect(nodeOwnerPolicyOptions({})).toEqual({ limit: null, overrides: new Map(), cellAdmission: "open" });
    expect(nodeOwnerPolicyOptions({
      MYCELLIOS_NODE_OWNER_LIMIT: "5",
      MYCELLIOS_NODE_OWNER_LIMIT_OVERRIDES: "operator-account=50, other=7",
      MYCELLIOS_CELL_ADMISSION: "enrolled",
    })).toEqual({ limit: 5, overrides: new Map([["operator-account", 50], ["other", 7]]), cellAdmission: "enrolled" });
    for (const broken of [
      { MYCELLIOS_NODE_OWNER_LIMIT: "0" }, { MYCELLIOS_NODE_OWNER_LIMIT: "five" },
      { MYCELLIOS_NODE_OWNER_LIMIT_OVERRIDES: "no-limit" }, { MYCELLIOS_NODE_OWNER_LIMIT_OVERRIDES: "=5" },
      { MYCELLIOS_CELL_ADMISSION: "closed" },
    ]) expect(() => nodeOwnerPolicyOptions(broken)).toThrow();
  });

  it("caps active nodes per account only when configured, with per-account overrides", async () => {
    const db = await database();
    for (const id of ["a1", "a2"]) await own(db, id, "account-a");
    await expect(new NodeOwnerPolicy(db).assertCanAddNode("account-a")).resolves.toBeUndefined();
    const capped = new NodeOwnerPolicy(db, { limit: 2, overrides: new Map([["operator", 10]]) });
    await expect(capped.assertCanAddNode("account-a")).rejects.toThrow("node_owner_limit_denied");
    await expect(capped.assertCanAddNode("account-b")).resolves.toBeUndefined();
    for (const id of ["o1", "o2", "o3"]) await own(db, id, "operator");
    await expect(capped.assertCanAddNode("operator")).resolves.toBeUndefined();
  });

  it("expels an account only for an operator's privacy-violation revocation", async () => {
    const db = await database();
    await own(db, "leaky", "account-leaky");
    await own(db, "lost", "account-lost");
    await credential(db, "leaky", "revoked", "node_privacy_violation: tripwire hit 2026-11-21");
    await credential(db, "lost", "revoked", "lost laptop");
    const policy = new NodeOwnerPolicy(db);
    await expect(policy.assertCanAddNode("account-leaky")).rejects.toThrow("node_owner_expelled_denied");
    await expect(policy.assertCanAddNode("account-lost")).resolves.toBeUndefined();
    expect(await policy.isExpelled("account-unknown")).toBe(false);
  });

  it("refuses new unowned cells only in enrolled mode", async () => {
    const db = await database();
    await credential(db, "known-cell", "active", null, "cell");
    await own(db, "enrolled-cell", "account-a", "cell");
    const open = new NodeOwnerPolicy(db);
    const enrolled = new NodeOwnerPolicy(db, { cellAdmission: "enrolled" });
    expect(await open.refusesNewCell("anonymous-cell", false)).toBe(false);
    expect(await enrolled.refusesNewCell("anonymous-cell", false)).toBe(true);
    expect(await enrolled.refusesNewCell("anonymous-cell", true)).toBe(false);
    expect(await enrolled.refusesNewCell("known-cell", false)).toBe(false);
    expect(await enrolled.refusesNewCell("enrolled-cell", false)).toBe(false);
  });
});

describe("where the policy applies", () => {
  const actor = { kind: "account" as const, id: "account-a", scopes: ["node:identity" as const] };

  it("stops enrollment at the limit, both when issuing and when redeeming", async () => {
    const db = await database();
    const policy = new NodeOwnerPolicy(db, { limit: 1 });
    const store = new NodeEnrollmentStore(db, undefined, policy);
    const issued = await store.issue({ accountId: "account-a", actor, expiresInSeconds: 600 });
    await store.confirm({ enrollmentId: issued.enrollmentId, accountId: "account-a", actorId: "account-a" });
    await own(db, "already", "account-a");
    await expect(store.issue({ accountId: "account-a", actor, expiresInSeconds: 600 })).rejects.toThrow("node_owner_limit_denied");
    expect(await store.consume({
      enrollmentToken: issued.enrollmentToken, nonce: issued.nonce, identityKind: "device", identityId: "second",
      publicKeyFingerprint: `sha256:${"b".repeat(64)}`,
    })).toEqual({ state: "owner-limit" });
    expect(await db.getNodeOwnership("device", "second")).toBeNull();
  });

  it("stops an expelled account from enrolling and from receiving a node", async () => {
    const db = await database();
    await own(db, "leaky", "account-a");
    await credential(db, "leaky", "revoked", "node_privacy_violation: tripwire");
    const policy = new NodeOwnerPolicy(db);
    await expect(new NodeEnrollmentStore(db, undefined, policy).issue({ accountId: "account-a", actor, expiresInSeconds: 600 }))
      .rejects.toThrow("node_owner_expelled_denied");
    await own(db, "gift", "account-b");
    const transfers = new NodeOwnershipTransferStore(db, undefined, policy);
    const transfer = await transfers.create({ nodeId: "gift", sourceAccountId: "account-b", targetAccountId: "account-a",
      expectedGeneration: 1, expiresInSeconds: 600 });
    await expect(transfers.accept({ transferId: transfer.transferId, transferToken: transfer.transferToken,
      targetAccountId: "account-a", nodeId: "gift" })).rejects.toThrow("node_owner_expelled_denied");
    expect((await db.getNodeOwnership("device", "gift"))?.accountId).toBe("account-b");
  });

  it("never lets the owner recover the credential of an expelled node", async () => {
    const db = await database();
    await own(db, "leaky", "account-1");
    await credential(db, "leaky", "revoked", "node_privacy_violation: tripwire");
    const authority = new WorkerAdmissionAuthority(db);
    const next = workerAdmissionSigner(generateWorkerAdmissionCredential());
    await expect(authority.issueRecovery({ identity: { kind: "device", id: "leaky" }, nextPublicKey: next.publicKey,
      protocol: { min: 1, max: 1 } }, "account-1")).rejects.toThrowError(expect.objectContaining({ code: "worker_ownership_expelled" }));
  });

  it("refuses a new public cell at registration in enrolled mode, but not the operator's", async () => {
    process.env.MYCELLIOS_CELL_ADMISSION = "enrolled";
    const runtime = await createCoordinator({
      host: "127.0.0.1", port: 0, databasePath: ":memory:", requestTimeoutMs: 10_000, allowDevelopmentAdapters: true,
      mobileAssetsPath: resolve("tests/fixtures/mobile-assets"), landingAssetsPath: resolve("tests/fixtures/landing-assets"),
      networkToken: "server-only-network-token", mobileJoinToken: "server-only-network-token",
    });
    runtimes.push(runtime);
    const register = async (id: string, authorization?: string) => {
      const signer = workerAdmissionSigner(generateWorkerAdmissionCredential());
      const identity = { kind: "cell" as const, id };
      const capabilities = workerCapabilities();
      const protocol = { min: 1, max: 1 };
      const registrationDigest = workerRegistrationDigest({ identity, capabilities, protocol });
      const headers = authorization ? { authorization } : {};
      const challenge = (await runtime.app.inject({ method: "POST", url: "/internal/v1/workers/admission-challenge", headers,
        payload: { identity, publicKey: signer.publicKey, protocol, registrationDigest } })).json() as { challengeId: string; signingPayload: string };
      return runtime.app.inject({ method: "POST", url: "/internal/v1/workers/register", headers, payload: {
        identity, capabilities, protocol,
        admission: { challengeId: challenge.challengeId, publicKey: signer.publicKey, protocol, registrationDigest,
          signature: signer.sign(challenge.signingPayload) },
      } });
    };
    const anonymous = await register("anonymous-cell");
    expect(anonymous.statusCode).toBe(403);
    expect(anonymous.json()).toMatchObject({ error: { code: "worker_cell_enrollment_required" } });
    expect(await runtime.database.listWorkerAdmissionCredentials()).toHaveLength(0);
    expect((await register("operator-cell", "Bearer server-only-network-token")).statusCode).toBe(201);
  });
});

function workerCapabilities(): WorkerCapabilities {
  const config = workerConfigSchema.parse({
    region: "es-mad", offeredVramMb: 4_096, limits: { maxConcurrency: 1, pauseWhenForeground: false },
    adapter: { kind: "mock", developmentOnly: true, model: "distributed-small", tokensPerSecond: 50, ttftMs: 10, failureRate: 0 },
    deployment: { modelDigest: "sha256:test", contextLimit: 8_192 },
  });
  return {
    region: config.region, agentVersion: "test",
    gpus: [{ id: "gpu-0", vendor: "test", model: "Test", physicalVramMb: 4_096, offeredVramMb: 4_096, freeOfferedVramMb: 4_096 }],
    limits: { maxConcurrency: 1, pauseWhenForeground: false },
    deployments: [{ deploymentId: "dep", model: "distributed-small", modelDigest: "sha256:test", mode: "replica", adapter: "mock",
      peakVramMb: 1_024, contextLimit: 8_192, maxConcurrency: 1, freeSlots: 1, tokensPerSecond: 50, ttftMs: 10, dataLocality: "local" }],
    network: { coordinatorRttMs: 1, uplinkMbps: 10, downlinkMbps: 10 },
  };
}

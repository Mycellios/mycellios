import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkerCapabilities } from "../src/contracts/types.js";
import { workerRegistrationDigest } from "../src/core/worker-admission-digest.js";
import {
  WorkerAdmissionAuthority,
  WorkerAdmissionError,
  workerAdmissionPublicKeyFingerprint,
} from "../src/coordinator/worker-admission.js";
import { MeshDatabase } from "../src/storage/database.js";
import {
  generateWorkerAdmissionCredential,
  workerAdmissionSigner,
} from "../src/worker/admission-credential.js";

const databases: MeshDatabase[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) (await database.close());
});

describe("signed worker admission", () => {
  it("enrolls one stable key and accepts it again without creating a duplicate identity", async () => {
    const authority = (await createAuthority());
    const signer = workerAdmissionSigner(generateWorkerAdmissionCredential());
    const first = (await admit(authority, signer, "desktop-a"));
    const second = (await admit(authority, signer, "desktop-a"));

    expect(first.enrollment).toBe("enrolled");
    expect(second).toEqual({
      protocolVersion: 1,
      credentialFingerprint: first.credentialFingerprint,
      enrollment: "accepted",
    });
  });

  it("consumes every challenge once and rejects replay", async () => {
    const authority = (await createAuthority());
    const signer = workerAdmissionSigner(generateWorkerAdmissionCredential());
    const identity = { kind: "device" as const, id: "desktop-replay" };
    const capabilities = workerCapabilities();
    const protocol = { min: 1, max: 1 };
    const registrationDigest = workerRegistrationDigest({
      identity,
      capabilities,
      protocol,
    });
    const challenge = authority.issue({
      identity,
      publicKey: signer.publicKey,
      protocol,
      registrationDigest,
    });
    const proof = {
      challengeId: challenge.challengeId,
      publicKey: signer.publicKey,
      protocol,
      registrationDigest,
      signature: signer.sign(challenge.signingPayload),
    };

    expect((await authority.verify({ identity, registrationDigest, proof })).enrollment).toBe("enrolled");
    await expect((async () => (await authority.verify({ identity, registrationDigest, proof })))()).rejects.toThrowError(
      expect.objectContaining({ code: "worker_admission_challenge_unknown" }),
    );
  });

  it("rejects a registration changed after the device signed its challenge", async () => {
    const authority = (await createAuthority());
    const signer = workerAdmissionSigner(generateWorkerAdmissionCredential());
    const identity = { kind: "device" as const, id: "desktop-tampered" };
    const capabilities = workerCapabilities();
    const protocol = { min: 1, max: 1 };
    const registrationDigest = workerRegistrationDigest({
      identity,
      capabilities,
      protocol,
    });
    const challenge = authority.issue({
      identity,
      publicKey: signer.publicKey,
      protocol,
      registrationDigest,
    });
    const changedDigest = workerRegistrationDigest({
      identity,
      capabilities: {
        ...capabilities,
        gpus: [{ ...capabilities.gpus[0]!, offeredVramMb: 65_536 }],
      },
      protocol,
    });

    await expect((async () => (await authority.verify({
      identity,
      registrationDigest: changedDigest,
      proof: {
        challengeId: challenge.challengeId,
        publicKey: signer.publicKey,
        protocol,
        registrationDigest,
        signature: signer.sign(challenge.signingPayload),
      },
    })))()).rejects.toThrowError(
      expect.objectContaining({ code: "worker_admission_registration_changed" }),
    );
  });

  it("does not let a new key silently take over an existing stable identity", async () => {
    const authority = (await createAuthority());
    (await admit(
      authority,
      workerAdmissionSigner(generateWorkerAdmissionCredential()),
      "desktop-bound",
    ));
    await expect((async () => (await admit(
      authority,
      workerAdmissionSigner(generateWorkerAdmissionCredential()),
      "desktop-bound",
    )))()).rejects.toThrowError(
      expect.objectContaining({ code: "worker_identity_key_mismatch" }),
    );
  });

  it("enforces the explicitly enrolled ownership fingerprint", async () => {
    const authority = (await createAuthority());
    const signer = workerAdmissionSigner(generateWorkerAdmissionCredential());
    const database = databases.at(-1)!;
    (await bindOwnership(database, "desktop-owned", `sha256:${"f".repeat(64)}`));

    await expect((async () => (await admit(authority, signer, "desktop-owned")))()).rejects.toThrowError(
      expect.objectContaining({ code: "worker_ownership_fingerprint_mismatch" }),
    );
    expect((await database.getWorkerAdmissionCredential("device", "desktop-owned"))).toBeNull();
  });

  it("admits the key explicitly bound by node enrollment", async () => {
    const authority = (await createAuthority());
    const signer = workerAdmissionSigner(generateWorkerAdmissionCredential());
    const database = databases.at(-1)!;
    (await bindOwnership(database, "desktop-owned-valid", workerAdmissionPublicKeyFingerprint(signer.publicKey)));

    expect((await admit(authority, signer, "desktop-owned-valid")).enrollment).toBe("enrolled");
  });

  it("accepts the persistent ECDSA P-256 proof used by browser workers", async () => {
    const authority = (await createAuthority());
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const admissionPublicKey = {
      algorithm: "ecdsa-p256-sha256" as const,
      spki: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
    };
    const identity = { kind: "browser" as const, id: "browser-stable-a" };
    const protocol = { min: 1, max: 1 };
    const registrationDigest = workerRegistrationDigest({
      identity,
      capabilities: workerCapabilities(),
      protocol,
    });
    const challenge = authority.issue({
      identity,
      publicKey: admissionPublicKey,
      protocol,
      registrationDigest,
    });
    const signature = sign(
      "sha256",
      Buffer.from(challenge.signingPayload, "utf8"),
      { key: privateKey, dsaEncoding: "ieee-p1363" },
    ).toString("base64url");

    expect((await authority.verify({
      identity,
      registrationDigest,
      proof: {
        challengeId: challenge.challengeId,
        publicKey: admissionPublicKey,
        protocol,
        registrationDigest,
        signature,
      },
    }))).toMatchObject({
      protocolVersion: 1,
      enrollment: "enrolled",
    });
  });

  it("rotates a credential only when both the current and replacement keys sign", async () => {
    const authority = (await createAuthority());
    const current = workerAdmissionSigner(generateWorkerAdmissionCredential());
    const next = workerAdmissionSigner(generateWorkerAdmissionCredential());
    const enrolled = (await admit(authority, current, "desktop-rotate"));
    const database = databases.at(-1)!;
    (await bindOwnership(database, "desktop-rotate", enrolled.credentialFingerprint));
    const identity = { kind: "device" as const, id: "desktop-rotate" };
    const challenge = (await authority.issueRotation({
      identity,
      currentPublicKey: current.publicKey,
      nextPublicKey: next.publicKey,
      protocol: { min: 1, max: 1 },
    }));

    const rotated = (await authority.verifyRotation({
      identity,
      proof: {
        challengeId: challenge.challengeId,
        currentSignature: current.sign(challenge.signingPayload),
        nextSignature: next.sign(challenge.signingPayload),
      },
    }));

    expect(rotated.previousFingerprint).toBe(enrolled.credentialFingerprint);
    expect(rotated.credentialFingerprint).not.toBe(enrolled.credentialFingerprint);
    expect((await database.getNodeOwnership("device", "desktop-rotate"))).toMatchObject({
      credentialFingerprint: rotated.credentialFingerprint,
      status: "active",
      generation: 2,
    });
    expect((await admit(authority, next, "desktop-rotate")).enrollment).toBe("accepted");
    await expect((async () => (await admit(authority, current, "desktop-rotate")))()).rejects.toThrowError(
      expect.objectContaining({ code: "worker_ownership_fingerprint_mismatch" }),
    );
  });

  it("revokes a credential idempotently and blocks later admission or rotation", async () => {
    const authority = (await createAuthority());
    const current = workerAdmissionSigner(generateWorkerAdmissionCredential());
    const enrolled = (await admit(authority, current, "desktop-revoked"));
    const database = databases.at(-1)!;
    (await bindOwnership(database, "desktop-revoked", enrolled.credentialFingerprint));
    const first = (await database.revokeWorkerAdmissionCredential({
      identityKind: "device",
      identityId: "desktop-revoked",
      expectedFingerprint: enrolled.credentialFingerprint,
      reason: "device reported stolen",
    }));
    const second = (await database.revokeWorkerAdmissionCredential({
      identityKind: "device",
      identityId: "desktop-revoked",
      expectedFingerprint: enrolled.credentialFingerprint,
      reason: "device reported stolen",
    }));

    expect(first.state).toBe("revoked");
    expect(second.state).toBe("already_revoked");
    expect((await database.getNodeOwnership("device", "desktop-revoked"))).toMatchObject({
      credentialFingerprint: enrolled.credentialFingerprint,
      status: "revoked",
      generation: 2,
    });
    await expect((async () => (await admit(authority, current, "desktop-revoked")))()).rejects.toThrowError(
      expect.objectContaining({ code: "worker_ownership_revoked" }),
    );
    await expect((async () => (await authority.issueRotation({
      identity: { kind: "device", id: "desktop-revoked" },
      currentPublicKey: current.publicKey,
      nextPublicKey: workerAdmissionSigner(generateWorkerAdmissionCredential()).publicKey,
      protocol: { min: 1, max: 1 },
    })))()).rejects.toThrowError(
      expect.objectContaining({ code: "worker_credential_revoked" }),
    );
  });

  it("recovers a lost key only with the owner account and replacement-key proof", async () => {
    const authority = (await createAuthority());
    const current = workerAdmissionSigner(generateWorkerAdmissionCredential());
    const next = workerAdmissionSigner(generateWorkerAdmissionCredential());
    const enrolled = (await admit(authority, current, "desktop-recover"));
    const database = databases.at(-1)!;
    (await bindOwnership(database, "desktop-recover", enrolled.credentialFingerprint));
    const identity = { kind: "device" as const, id: "desktop-recover" };
    await expect((async () => (await authority.issueRecovery({ identity, nextPublicKey: next.publicKey, protocol: { min: 1, max: 1 } }, "account-2")))()).rejects
      .toThrowError(expect.objectContaining({ code: "worker_recovery_owner_mismatch" }));

    const challenge = (await authority.issueRecovery({ identity, nextPublicKey: next.publicKey, protocol: { min: 1, max: 1 } }, "account-1"));
    await expect((async () => (await authority.verifyRecovery(identity, { challengeId: challenge.challengeId, nextSignature: current.sign(challenge.signingPayload) }, "account-1")))()).rejects
      .toThrowError(expect.objectContaining({ code: "worker_recovery_signature_invalid" }));
    const retry = (await authority.issueRecovery({ identity, nextPublicKey: next.publicKey, protocol: { min: 1, max: 1 } }, "account-1"));
    const recovered = (await authority.verifyRecovery(identity, { challengeId: retry.challengeId, nextSignature: next.sign(retry.signingPayload) }, "account-1"));
    expect(recovered.generation).toBe(2);
    expect((await database.getNodeOwnership("device", identity.id))).toMatchObject({
      accountId: "account-1", status: "active", generation: 2,
      credentialFingerprint: recovered.credentialFingerprint,
    });
    await expect((async () => (await admit(authority, current, identity.id)))()).rejects.toThrowError(expect.objectContaining({ code: "worker_ownership_fingerprint_mismatch" }));
    expect((await admit(authority, next, identity.id)).enrollment).toBe("accepted");
    expect(((await database.raw.prepare("SELECT event_type, generation, actor_kind FROM node_identity_events WHERE identity_id = ? ORDER BY sequence").all(identity.id)) as Array<Record<string, unknown>>))
      .toMatchObject([{ event_type: "credential.recovered", generation: 2, actor_kind: "account" }]);
  });

  it("rejects protocol ranges that do not overlap the coordinator", async () => {
    const authority = (await createAuthority());
    const signer = workerAdmissionSigner(generateWorkerAdmissionCredential());
    expect(() => authority.issue({
      identity: { kind: "device", id: "desktop-new-protocol" },
      publicKey: signer.publicKey,
      protocol: { min: 2, max: 4 },
      registrationDigest: `sha256:${"a".repeat(64)}`,
    })).toThrowError(
      expect.objectContaining({
        code: "worker_protocol_incompatible",
        statusCode: 426,
      } satisfies Partial<WorkerAdmissionError>),
    );
  });
});

async function createAuthority(): Promise<WorkerAdmissionAuthority> {
  const database = (await MeshDatabase.open(":memory:"));
  databases.push(database);
  return new WorkerAdmissionAuthority(database);
}

async function bindOwnership(database: MeshDatabase, identityId: string, fingerprint: string): Promise<void> {
  const now = Date.now();
  (await database.raw.prepare(
    `INSERT INTO node_ownership(
       identity_kind, identity_id, account_id, credential_fingerprint,
       status, generation, created_at, updated_at
     ) VALUES ('device', ?, 'account-1', ?, 'active', 1, ?, ?)`,
  ).run(identityId, fingerprint, now, now));
}

async function admit(
  authority: WorkerAdmissionAuthority,
  signer: ReturnType<typeof workerAdmissionSigner>,
  id: string,
) {
  const identity = { kind: "device" as const, id };
  const capabilities = workerCapabilities();
  const protocol = { min: 1, max: 1 };
  const registrationDigest = workerRegistrationDigest({
    identity,
    capabilities,
    protocol,
  });
  const challenge = authority.issue({
    identity,
    publicKey: signer.publicKey,
    protocol,
    registrationDigest,
  });
  return (await authority.verify({
    identity,
    registrationDigest,
    proof: {
      challengeId: challenge.challengeId,
      publicKey: signer.publicKey,
      protocol,
      registrationDigest,
      signature: signer.sign(challenge.signingPayload),
    },
  }));
}

function workerCapabilities(): WorkerCapabilities {
  return {
    region: "es-mad",
    agentVersion: "test",
    gpus: [{
      id: "gpu-0",
      vendor: "nvidia",
      model: "Synthetic GPU",
      physicalVramMb: 8_192,
      offeredVramMb: 4_096,
      freeOfferedVramMb: 4_096,
    }],
    limits: { maxConcurrency: 1, pauseWhenForeground: false },
    deployments: [],
    network: { coordinatorRttMs: 10, uplinkMbps: 100, downlinkMbps: 100 },
  };
}

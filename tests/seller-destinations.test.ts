import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SellerDestinationError,
  SellerDestinationManager,
  sellerDestinationFingerprint,
  sellerDestinationSigningBytes,
  type SellerDestinationAttestation,
} from "../src/coordinator/seller-destinations.js";
import { MeshDatabase } from "../src/storage/database.js";

describe("signed seller payout destinations", () => {
  const now = 1_800_000_000_000;
  const keys = generateKeyPairSync("ed25519");
  let database: MeshDatabase;
  let manager: SellerDestinationManager;

  beforeEach(async () => {
    database = (await MeshDatabase.open(":memory:"));
    manager = new SellerDestinationManager(database, new Map([[
      "destination-verifier",
      keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    ]]), () => now);
  });
  afterEach(async () => (await database.close()));

  function attestation(id: string, reference = `provider-${id}`): SellerDestinationAttestation {
    const unsigned = {
      schema: "mycellios.seller-destination.v1" as const,
      destinationId: id,
      sellerId: "seller-1",
      payoutMethod: "stable" as const,
      destinationKind: "provider_account" as const,
      destinationReference: reference,
      destinationFingerprint: sellerDestinationFingerprint("provider_account", reference),
      verifiedAt: now - 1_000,
      expiresAt: now + 86_400_000,
      verifierKeyId: "destination-verifier",
    };
    return {
      ...unsigned,
      signature: sign(null, sellerDestinationSigningBytes(unsigned), keys.privateKey).toString("base64url"),
    };
  }

  it("records a valid attestation and replays it without mutation", async () => {
    const input = attestation("destination-1");
    expect((await manager.record(input))).toMatchObject({
      id: "destination-1", sellerId: "seller-1", status: "active",
      destinationFingerprint: input.destinationFingerprint,
    });
    expect((await manager.record(input))).toEqual((await manager.active("seller-1", "stable")));
  });

  it("rejects tampering, unknown verifiers and expired attestations", async () => {
    const valid = attestation("destination-tamper");
    await expect((async () => (await manager.record({ ...valid, destinationReference: "provider-tampered" })))()).rejects.toThrowError(
      expect.objectContaining({ code: "destination_fingerprint_mismatch" } satisfies Partial<SellerDestinationError>),
    );
    await expect((async () => (await manager.record({ ...valid, verifierKeyId: "unknown" })))()).rejects.toThrowError(
      expect.objectContaining({ code: "untrusted_destination_verifier" } satisfies Partial<SellerDestinationError>),
    );
    const expired = { ...attestation("destination-expired"), expiresAt: now - 1 };
    await expect((async () => (await manager.record(expired)))()).rejects.toThrowError(
      expect.objectContaining({ code: "invalid_destination_validity" } satisfies Partial<SellerDestinationError>),
    );
  });

  it("rotates atomically and supports explicit revocation", async () => {
    (await manager.record(attestation("destination-old")));
    const replacement = (await manager.record(attestation("destination-new")));
    expect((await manager.active("seller-1", "stable"))).toMatchObject({ id: replacement.id });
    expect((await database.raw.prepare(
      "SELECT status FROM seller_payout_destinations WHERE id = 'destination-old'",
    ).get())).toEqual({ status: "revoked" });
    expect((await manager.revoke("seller-1", "stable"))).toBe(true);
    expect((await manager.active("seller-1", "stable"))).toBeNull();
    await expect((async () => (await database.raw.prepare(
      `UPDATE seller_payout_destinations
       SET status = 'active', revoked_at = NULL WHERE id = 'destination-old'`,
    ).run()))()).rejects.toThrow(/invalid_seller_payout_destination_lifecycle/);
  });

  it("seals signed destination content and retains revoked history", async () => {
    (await manager.record(attestation("destination-sealed")));

    await expect((async () => (await database.raw.prepare(
      `UPDATE seller_payout_destinations
       SET destination_reference = 'provider-attacker' WHERE id = 'destination-sealed'`,
    ).run()))()).rejects.toThrow(/immutable_seller_payout_destination_content/);
    await expect((async () => (await database.raw.prepare(
      `UPDATE seller_payout_destinations
       SET destination_fingerprint = ? WHERE id = 'destination-sealed'`,
    ).run("f".repeat(64))))()).rejects.toThrow(/immutable_seller_payout_destination_content/);
    await expect((async () => (await database.raw.prepare(
      "DELETE FROM seller_payout_destinations WHERE id = 'destination-sealed'",
    ).run()))()).rejects.toThrow(/immutable_seller_payout_destination/);

    expect((await manager.revoke("seller-1", "stable"))).toBe(true);
    await expect((async () => (await database.raw.prepare(
      "DELETE FROM seller_payout_destinations WHERE id = 'destination-sealed'",
    ).run()))()).rejects.toThrow(/immutable_seller_payout_destination/);
  });

  it("binds destination-backed batches to the exact active signed attestation", async () => {
    const destination = attestation("destination-batch");
    (await manager.record(destination));
    const insertBatch = database.raw.prepare(`
      INSERT INTO payout_batches (
        id, seller_id, payout_method, idempotency_key, request_digest,
        gross_usd_micros, debt_offset_usd_micros, amount_usd_micros,
        destination_id, destination_reference, destination_fingerprint,
        status, created_at, updated_at
      ) VALUES (?, 'seller-1', 'stable', ?, ?, 125000, 0, 125000,
        'destination-batch', ?, ?, 'prepared', ?, ?)
    `);

    await expect((async () => (await insertBatch.run(
      "batch-tampered-destination", "destination-key-1", "digest-1",
      "provider-attacker", destination.destinationFingerprint, now, now,
    )))()).rejects.toThrow(/invalid_payout_batch_destination_binding/);

    expect((await manager.revoke("seller-1", "stable"))).toBe(true);
    await expect((async () => (await insertBatch.run(
      "batch-revoked-destination", "destination-key-2", "digest-2",
      destination.destinationReference, destination.destinationFingerprint, now, now,
    )))()).rejects.toThrow(/invalid_payout_batch_destination_binding/);
  });
});

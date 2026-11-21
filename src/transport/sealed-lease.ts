import {
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import {
  SEALED_LEASE_VERSION,
  type SealedLease,
  type SealedLeaseBinding,
  type SealingAnnouncement,
} from "../contracts/sealed-lease.js";

const INFO = "mycellios-sealed-lease/1";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export class SealedLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealedLeaseError";
  }
}

/** A per-connection key pair. The private key never leaves process memory. */
export function generateSealingKeyPair(): { privateKey: KeyObject; announcement: SealingAnnouncement } {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  return { privateKey, announcement: { version: SEALED_LEASE_VERSION, publicKey: rawPublicKey(publicKey) } };
}

/** Encrypts one lease's request to the worker's announced key. */
export function sealLeaseRequest(
  request: unknown,
  recipientPublicKey: string,
  binding: SealedLeaseBinding,
): SealedLease {
  const recipient = importPublicKey(recipientPublicKey);
  const ephemeral = generateKeyPairSync("x25519");
  const ephemeralPublicKey = rawPublicKey(ephemeral.publicKey);
  const key = deriveKey(ephemeral.privateKey, recipient, ephemeralPublicKey, recipientPublicKey, binding);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(associatedData(binding));
  const plaintext = Buffer.from(JSON.stringify(request), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  plaintext.fill(0);
  key.fill(0);
  return {
    version: SEALED_LEASE_VERSION,
    ephemeralPublicKey,
    nonce: nonce.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

/** Decrypts a sealed request in memory. Throws SealedLeaseError on any mismatch. */
export function openLeaseRequest(
  sealed: SealedLease,
  privateKey: KeyObject,
  ownPublicKey: string,
  binding: SealedLeaseBinding,
): unknown {
  if (sealed.version !== SEALED_LEASE_VERSION) throw new SealedLeaseError("Unsupported sealed lease version");
  const nonce = Buffer.from(sealed.nonce, "base64url");
  const body = Buffer.from(sealed.ciphertext, "base64url");
  if (nonce.length !== NONCE_BYTES || body.length <= TAG_BYTES) throw new SealedLeaseError("Malformed sealed lease");
  const key = deriveKey(privateKey, importPublicKey(sealed.ephemeralPublicKey), sealed.ephemeralPublicKey, ownPublicKey, binding);
  let plaintext: Buffer | undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(associatedData(binding));
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    plaintext = Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as unknown;
  } catch {
    throw new SealedLeaseError("Sealed lease could not be opened");
  } finally {
    plaintext?.fill(0);
    key.fill(0);
  }
}

function deriveKey(
  privateKey: KeyObject,
  peerPublicKey: KeyObject,
  ephemeralPublicKey: string,
  recipientPublicKey: string,
  binding: SealedLeaseBinding,
): Buffer {
  let shared: Buffer;
  try {
    shared = diffieHellman({ privateKey, publicKey: peerPublicKey });
  } catch {
    throw new SealedLeaseError("Sealed lease key agreement failed");
  }
  // A small-order peer key yields an all-zero secret; never derive from it.
  if (shared.every((byte) => byte === 0)) throw new SealedLeaseError("Sealed lease key agreement failed");
  const info = Buffer.from(`${INFO}\n${ephemeralPublicKey}\n${recipientPublicKey}`, "utf8");
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.from(binding.leaseId, "utf8"), info, 32));
  shared.fill(0);
  return key;
}

function associatedData(binding: SealedLeaseBinding): Buffer {
  return Buffer.from(
    `${INFO}\n${binding.jobId}\n${binding.leaseId}\n${binding.modelDigest}\n${binding.deadlineAt}`,
    "utf8",
  );
}

function rawPublicKey(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: "jwk" });
  if (jwk.crv !== "X25519" || typeof jwk.x !== "string") throw new SealedLeaseError("Expected an X25519 key");
  return jwk.x;
}

function importPublicKey(raw: string): KeyObject {
  try {
    return createPublicKey({ key: { kty: "OKP", crv: "X25519", x: raw }, format: "jwk" });
  } catch {
    throw new SealedLeaseError("Invalid X25519 public key");
  }
}

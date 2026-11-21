import { z } from "zod";

/**
 * Sealed lease offers (specs/node-owner-privacy, D4). A worker announces an
 * X25519 public key that exists only in its process memory for one
 * connection; the coordinator encrypts each request to it. Coordinators
 * advertise support with this registration response header, and workers only
 * announce a key to a coordinator that sent it, so neither side ever sees a
 * field the other does not understand.
 */
export const SEALED_LEASES_HEADER = "x-mycellios-sealed-leases";
export const SEALED_LEASE_VERSION = 1;

const BASE64URL = /^[A-Za-z0-9_-]+$/;
/** An X25519 public key: 32 raw bytes, base64url without padding. */
const X25519_PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;

export const sealingAnnouncementSchema = z.object({
  version: z.literal(SEALED_LEASE_VERSION),
  publicKey: z.string().regex(X25519_PUBLIC_KEY),
}).strict();

export const sealedLeaseSchema = z.object({
  version: z.literal(SEALED_LEASE_VERSION),
  ephemeralPublicKey: z.string().regex(X25519_PUBLIC_KEY),
  /** 12-byte AES-GCM nonce. */
  nonce: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  /** Ciphertext followed by the 16-byte tag. */
  ciphertext: z.string().min(22).max(3 * 1024 * 1024).regex(BASE64URL),
}).strict();

export type SealingAnnouncement = z.infer<typeof sealingAnnouncementSchema>;
export type SealedLease = z.infer<typeof sealedLeaseSchema>;

/** Lease fields bound to the ciphertext, so it cannot be replayed into another lease. */
export interface SealedLeaseBinding {
  jobId: string;
  leaseId: string;
  modelDigest: string;
  deadlineAt: number;
}

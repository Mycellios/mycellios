import type { KeyObject } from "node:crypto";
import { chatCompletionRequestSchema } from "../contracts/schemas.js";
import type { SealedLease } from "../contracts/sealed-lease.js";
import type { ChatCompletionRequest, JobPayload } from "../contracts/types.js";
import { generateSealingKeyPair, openLeaseRequest, SealedLeaseError } from "../transport/sealed-lease.js";

/** The key a worker holds for one coordinator connection; memory only. */
export interface WorkerSealingKey {
  privateKey: KeyObject;
  publicKey: string;
}

export interface LeaseOffer {
  jobId: string;
  leaseId: string;
  modelDigest: string;
  deadlineAt: number;
  request?: unknown;
  sealed?: SealedLease | undefined;
}

/** A fresh key for a new connection, and the hello payload that announces it. */
export function sealingHello(coordinatorSealsLeases: boolean): { key: WorkerSealingKey | null; hello: object } {
  if (!coordinatorSealsLeases) return { key: null, hello: {} };
  const { privateKey, announcement } = generateSealingKeyPair();
  return { key: { privateKey, publicKey: announcement.publicKey }, hello: { sealing: announcement } };
}

/**
 * Turns an offer into the job the worker runs, opening a sealed request in
 * memory (specs/node-owner-privacy, D4). Throws when a sealed offer cannot be
 * opened with this connection's key or its content is not a valid request.
 */
export function leaseOfferJob(offer: LeaseOffer, key: WorkerSealingKey | null): JobPayload {
  const binding = { jobId: offer.jobId, leaseId: offer.leaseId, modelDigest: offer.modelDigest, deadlineAt: offer.deadlineAt };
  if (!offer.sealed) return { ...binding, request: offer.request as ChatCompletionRequest };
  if (!key) throw new SealedLeaseError("Sealed lease without an announced key");
  const request = chatCompletionRequestSchema.safeParse(openLeaseRequest(offer.sealed, key.privateKey, key.publicKey, binding));
  if (!request.success) throw new SealedLeaseError("Sealed lease carries an invalid request");
  return { ...binding, request: request.data as ChatCompletionRequest };
}

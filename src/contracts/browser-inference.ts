import { z } from "zod";
import { browserTextOfferSchema, browserTextRequestSchema } from "./browser-text.js";

/** Operator-approved, immutable expert revision. Prices never come from a worker. */
export const browserExpertOfferSchema = z.object({
  model: z.string().regex(/^mycellios-browser\/[A-Za-z0-9._-]{1,100}$/),
  artifactId: z.string().regex(/^[a-f0-9]{64}$/),
  costMicrounitsPerRow: z.number().int().positive().max(1_000_000),
  maxRows: z.number().int().positive().max(64),
}).strict();
export const browserInferenceOfferSchema = z.union([browserExpertOfferSchema, browserTextOfferSchema]);
export type BrowserInferenceOffer = z.infer<typeof browserInferenceOfferSchema>;
export const browserExpertRequestSchema = z.object({
  model: browserExpertOfferSchema.shape.model,
  rows: z.number().int().positive().max(64),
  hiddenSize: z.number().int().positive().max(16_384),
  activationsBase64: z.string().min(4).max(2 * 1024 * 1024),
}).strict();
export const browserInferenceRequestSchema = z.union([browserExpertRequestSchema, browserTextRequestSchema]);
export type BrowserInferenceRequest = z.infer<typeof browserInferenceRequestSchema>;
export const browserContributorProofSchema = z.object({
  workerId: z.string().uuid(), token: z.string().min(32).max(256),
}).strict();

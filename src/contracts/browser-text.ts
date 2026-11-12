import { z } from "zod";

/** Complete, pretrained model pilot. No user-selected URLs, graphs or executable code. */
export const browserTextModel = {
  id: "gpt2-q8-v1", name: "GPT-2 · 124M · Browser", license: "MIT",
  repository: "Xenova/gpt2", revision: "bf2c7f02e0b826c60d03af341171bde20893da66",
  files: {
    "model.onnx": { source: "onnx/decoder_model_quantized.onnx", bytes: 126556880, sha256: "419f6a0fe721ce9f41f35512347c58132b2e178310454231ca6ec04ff5029445" },
    "vocab.json": { source: "vocab.json", bytes: 798156, sha256: "3ba3c3109ff33976c4bd966589c11ee14fcaa1f4c9e5e154c2ed7f99d80709e7" },
    "merges.txt": { source: "merges.txt", bytes: 456318, sha256: "1ce1664773c50f3e0cc8842619a93edc4624525b728b188a9e0be33b7726adc5" },
  },
} as const;
export const browserTextRequestSchema = z.object({
  kind: z.literal("text"), model: z.string().regex(/^mycellios-browser\/[A-Za-z0-9._-]{1,100}$/),
  prompt: z.string().min(1).max(2048), maxTokens: z.number().int().min(1).max(32),
}).strict();
export type BrowserTextRequest = z.infer<typeof browserTextRequestSchema>;
export const browserTextOfferSchema = z.object({
  kind: z.literal("text"), model: browserTextRequestSchema.shape.model,
  artifactId: z.literal(browserTextModel.files["model.onnx"].sha256),
  costMicrounitsPerToken: z.number().int().positive().max(10_000),
  maxOutputTokens: z.number().int().min(1).max(32),
}).strict();
export const browserTextResultSchema = z.object({
  text: z.string().max(8192), inputTokens: z.number().int().min(1).max(128),
  tokenIds: z.array(z.number().int().min(0).max(50256)).min(1).max(32),
  finishReason: z.enum(["stop", "length"]),
}).strict();
export type BrowserTextResult = z.infer<typeof browserTextResultSchema>;
export const browserTextTaskSchema = z.object({
  taskId: z.string().uuid(), leaseId: z.string().uuid(),
  artifactId: browserTextOfferSchema.shape.artifactId,
  request: browserTextRequestSchema, deadlineAt: z.number().int().positive(),
}).strict();
export const browserTextReplySchema = z.object({
  taskId: z.string().uuid(), leaseId: z.string().uuid(), artifactId: browserTextOfferSchema.shape.artifactId,
  tokenIds: browserTextResultSchema.shape.tokenIds,
}).strict();

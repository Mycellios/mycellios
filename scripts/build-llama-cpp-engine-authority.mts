/**
 * Build the engine activation authority (MYCELLIOS_ENGINE_ACTIVATION_AUTHORITY)
 * for one pinned GGUF served by the llama.cpp engine family.
 *
 *   npx tsx scripts/build-llama-cpp-engine-authority.mts input.json output.json
 *
 * The input names the pinned artifact, the measured reference costs and the
 * parity evidence files. Nothing is invented here: the tensor manifest is read
 * from disk and must carry the pinned id, the parity digest is the hash of the
 * evidence files as given, and the result is validated with the same schema
 * the coordinator loads at startup.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { sha256CanonicalEvidence } from "../src/core/json.js";
import {
  ENGINE_CERTIFICATION_SCHEMA,
  ENGINE_FAMILY_DESCRIPTOR_SCHEMA,
  sealEngineCertification,
} from "../src/contracts/engine-family.js";
import {
  ENGINE_ACTIVATION_AUTHORITY_SCHEMA,
  engineActivationAuthoritySchema,
} from "../src/coordinator/engine-activation-authority.js";

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const inputSchema = z.object({
  modelId: z.string().min(1),
  modelRevision: z.string().regex(/^[0-9a-f]{40}$/),
  quantization: z.string().min(1),
  runtimeAbi: z.string().min(1),
  runtimeArchiveSha256: hex64,
  sourceRevision: z.string().regex(/^[0-9a-f]{40}$/),
  backends: z.array(z.enum(["cpu", "vulkan"])).min(1),
  hardwareClasses: z.array(z.string().min(1)).min(1),
  contextTokens: z.number().int().positive(),
  validDays: z.number().int().positive().max(365),
  artifact: z.object({
    url: z.string().url(),
    sha256: hex64,
    sizeBytes: z.number().int().positive(),
    tensorManifestUrl: z.string().url(),
    tensorManifestId: hex64,
    tensorManifestPath: z.string().min(1),
  }).strict(),
  probe: z.object({
    attentionHeads: z.number().int().positive(),
    kvHeads: z.number().int().positive(),
    headDim: z.number().int().positive(),
    referenceDecodeMsPerToken: z.number().positive(),
    referencePrefillMsPerToken: z.number().positive(),
    minimumSamples: z.number().int().min(7),
  }).strict(),
  parity: z.object({
    evidenceClass: z.enum(["fixture", "loopback", "lan", "wan"]),
    files: z.array(z.string().min(1)).min(1),
  }).strict(),
}).strict();

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("usage: build-llama-cpp-engine-authority.mts input.json output.json");
  process.exit(2);
}
const input = inputSchema.parse(JSON.parse(await readFile(inputPath, "utf8")));

const manifest = JSON.parse(await readFile(input.artifact.tensorManifestPath, "utf8")) as {
  manifestId?: string; source?: { sha256?: string; sizeBytes?: number };
};
if (
  manifest.manifestId !== input.artifact.tensorManifestId
  || manifest.source?.sha256 !== input.artifact.sha256
  || manifest.source?.sizeBytes !== input.artifact.sizeBytes
) throw new Error("tensor_manifest_does_not_match_the_pinned_artifact");

const parityHash = createHash("sha256");
for (const file of input.parity.files) parityHash.update(await readFile(file));

const manifestDigest = `sha256:${input.artifact.tensorManifestId}` as const;
const targets = input.backends.map((backend) => ({
  platform: "win32" as const,
  arch: "x64" as const,
  backend,
  runtimeAbi: input.runtimeAbi,
  quantizations: [input.quantization],
  context: { minTokens: 1, maxTokens: input.contextTokens },
  graphMode: "optional" as const,
  minDriver: null,
}));
const descriptor = {
  schema: ENGINE_FAMILY_DESCRIPTOR_SCHEMA,
  familyId: "llama-cpp-gguf",
  version: "1.0.0",
  // The pinned llama.cpp archive is the implementation every stage runs.
  implementationDigest: `sha256:${input.runtimeArchiveSha256}`,
  tensorAbi: "mycellios-tensor-v1",
  model: {
    modelId: input.modelId,
    revision: input.modelRevision,
    manifestDigest,
    nativeAdapterId: "llama-cpp-gguf-v1",
    implementationContract: "mycellios-native-gguf-v1",
  },
  ownership: { embeddings: "head", outputHead: "tail", tokenizer: "root", sharedTensorIds: [] },
  operations: ["prepare", "load", "prefill", "verify", "decode", "reset",
    "checkpoint", "rollback", "health", "receipt-observe", "unload"],
  targets,
  boundaryConstraints: [],
};
const now = Date.now();
const certification = sealEngineCertification({
  schema: ENGINE_CERTIFICATION_SCHEMA,
  descriptorDigest: sha256CanonicalEvidence(descriptor) as `sha256:${string}`,
  // The Mycellios revision whose stage runner produced the parity evidence.
  sourceId: `sha256:${createHash("sha256").update(`git:${input.sourceRevision}`).digest("hex")}`,
  artifactManifestDigest: manifestDigest,
  status: "certified",
  validFrom: new Date(now).toISOString(),
  expiresAt: new Date(now + input.validDays * 86_400_000).toISOString(),
  targets,
  hardwareClasses: input.hardwareClasses,
  parity: [{
    kind: "tokens",
    evidenceDigest: `sha256:${parityHash.digest("hex")}`,
    evidenceClass: input.parity.evidenceClass,
  }],
});
const authority = engineActivationAuthoritySchema.parse({
  schema: ENGINE_ACTIVATION_AUTHORITY_SCHEMA,
  descriptor,
  certification,
  artifact: {
    format: "gguf",
    url: input.artifact.url,
    sha256: input.artifact.sha256,
    sizeBytes: input.artifact.sizeBytes,
    tensorManifestUrl: input.artifact.tensorManifestUrl,
    tensorManifestId: input.artifact.tensorManifestId,
    executor: "llama-cpp",
  },
  probe: { kind: "llama-cpp-gguf-v1", quantization: input.quantization, ...input.probe },
});
await writeFile(outputPath, `${JSON.stringify(authority, null, 2)}\n`);
console.log(JSON.stringify({
  output: outputPath,
  certificationId: authority.certification.certificationId,
  descriptorDigest: authority.certification.descriptorDigest,
  expiresAt: authority.certification.expiresAt,
}));

import { createHash } from "node:crypto";
import { canonicalEvidenceJson } from "../core/json.js";
import type { GgufTensorManifest } from "../contracts/gguf-tensor-manifest.js";
import type { CompiledModelProfile } from "./auto-distribute.js";
import type { LayerProfile } from "./types.js";

/**
 * Planner profile of a quantized GGUF, computed from its pinned tensor
 * manifest without downloading the model. Layer sizes are the quantized
 * bytes each stage package holds, so the planner budgets what nodes really
 * load. Compute timings are the same seed estimates the safetensors profiler
 * uses until measured profiles replace them.
 */
export const GGUF_PROFILE_FORMAT = "gguf";
/** Seeds shared with python/distributed_runtime/profile.py (ModelProfileOptions). */
const RUNTIME_OVERHEAD_BYTES_PER_STAGE = 256 * 1024 * 1024;
const DECODE_MS_PER_LAYER_AT_UNIT = 1.0;
const PREFILL_MS_PER_TOKEN_AT_UNIT = 0.05;
/** llama.cpp keeps its KV cache in float16. */
const KV_ELEMENT_BYTES = 2;
const BLOCK_TENSOR = /^blk\.(\d+)\./;

export interface GgufProfileModel {
  /** The requested model id, also the Hugging Face source of the tokenizer. */
  modelId: string;
  /** Certified model coordinates sealed into every stage package. */
  canonicalSource: string;
  canonicalRevision: string;
}

/** The model identity every stage package of this GGUF reports. */
export function ggufNativeModelIdentity(manifest: GgufTensorManifest): string {
  const configSha256 = createHash("sha256").update(manifest.configText, "utf8").digest("hex");
  return `sha256:${createHash("sha256").update(canonicalEvidenceJson({
    schema: "gdlp-native-gguf-model-identity/1",
    sourceGgufSha256: manifest.source.sha256,
    configSha256,
  })).digest("hex")}`;
}

export function compileGgufModelProfile(
  manifest: GgufTensorManifest,
  model: GgufProfileModel,
): CompiledModelProfile {
  const config = JSON.parse(manifest.configText) as Record<string, unknown>;
  const totalLayers = positive(config.num_hidden_layers, "num_hidden_layers");
  const hiddenSize = positive(config.hidden_size, "hidden_size");
  const attentionHeads = positive(config.num_attention_heads, "num_attention_heads");
  const kvHeads = config.num_key_value_heads === undefined
    ? attentionHeads
    : positive(config.num_key_value_heads, "num_key_value_heads");
  const headDim = config.head_dim === undefined
    ? hiddenSize / attentionHeads
    : positive(config.head_dim, "head_dim");
  if (!Number.isSafeInteger(headDim)) throw new Error("gguf_profile_head_dim_is_invalid");

  const blocks = Array.from({ length: totalLayers }, () => ({ bytes: 0, largest: 0 }));
  let embeddingBytes = 0;
  let headBytes = 0;
  let residualBytes = 0;
  let largestResidual = 0;
  for (const tensor of manifest.tensors) {
    const block = BLOCK_TENSOR.exec(tensor.name);
    if (block) {
      const entry = blocks[Number(block[1])];
      if (!entry) throw new Error(`gguf_profile_block_is_outside_the_model:${tensor.name}`);
      entry.bytes += tensor.sizeBytes;
      entry.largest = Math.max(entry.largest, tensor.sizeBytes);
    } else if (tensor.name === "token_embd.weight") {
      embeddingBytes += tensor.sizeBytes;
    } else if (tensor.name === "output.weight") {
      headBytes += tensor.sizeBytes;
    } else {
      residualBytes += tensor.sizeBytes;
      largestResidual = Math.max(largestResidual, tensor.sizeBytes);
    }
  }
  if (embeddingBytes === 0) throw new Error("gguf_profile_embedding_is_missing");
  const missing = blocks.findIndex((entry) => entry.bytes === 0);
  if (missing >= 0) throw new Error(`gguf_profile_block_has_no_tensors:${missing}`);
  // Without output.weight the head is tied: the tail stage borrows its own
  // copy of token_embd, so split routes budget the matrix twice.
  const tied = headBytes === 0;
  const lmHeadBytes = (tied ? embeddingBytes : headBytes) + residualBytes;
  const kvBytesPerToken = 2 * kvHeads * headDim * KV_ELEMENT_BYTES;
  const layers: LayerProfile[] = blocks.map((entry, index) => ({
    index,
    weightBytes: entry.bytes,
    largestResidentTensorBytes: entry.largest,
    activationElements: hiddenSize,
    kvBytesPerToken,
    decodeMsAtUnit: DECODE_MS_PER_LAYER_AT_UNIT,
    prefillMsPerTokenAtUnit: PREFILL_MS_PER_TOKEN_AT_UNIT,
  }));
  const artifactIdentity = ggufNativeModelIdentity(manifest);
  return {
    schema: "gdlp-model-profile/1",
    source: {
      model: model.modelId,
      // The root loads its tokenizer from the Hugging Face source; the stage
      // weights come only from the pinned GGUF.
      revision: null,
      snapshotCommit: null,
      snapshotIdentityUint64Hex: artifactIdentity.slice("sha256:".length, "sha256:".length + 16),
      artifactIdentity,
      canonicalSource: model.canonicalSource,
      canonicalRevision: model.canonicalRevision,
      format: GGUF_PROFILE_FORMAT,
    },
    inspection: { architecture: manifest.architecture, calibrationRequired: true },
    compatibility: { selectiveSafetensors: false, requiresAdapter: false, adapterId: null, reasons: [] },
    model: {
      id: model.modelId,
      layers,
      embeddingBytes,
      lmHeadBytes,
      largestEmbeddingTensorBytes: embeddingBytes,
      largestLmHeadTensorBytes: Math.max(tied ? embeddingBytes : headBytes, largestResidual),
      tiedEmbeddingAndHead: tied,
      runtimeOverheadBytesPerStage: RUNTIME_OVERHEAD_BYTES_PER_STAGE,
      embeddingDecodeMsAtUnit: 0,
      lmHeadDecodeMsAtUnit: 0,
      embeddingPrefillMsPerTokenAtUnit: 0,
      lmHeadPrefillMsPerTokenAtUnit: 0,
    },
  };
}

function positive(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`gguf_profile_config_${name}_is_invalid`);
  }
  return value as number;
}

import { describe, expect, it } from "vitest";
import {
  ggufTensorManifestIdentity,
  ggufTensorManifestSchema,
} from "../src/contracts/gguf-tensor-manifest.js";

// Produced by Python's native_gguf._canonical_json (ensure_ascii=False, sorted
// keys, compact separators). The config text exercises quotes, backslashes,
// tabs, newlines, a non-ASCII letter and U+2028.
const PYTHON_MANIFEST = {
  schema: "gdlp-gguf-tensor-manifest/1",
  source: { sha256: "a".repeat(64), sizeBytes: 4096 },
  header: { sizeBytes: 1024, sha256: "b".repeat(64) },
  architecture: "llama",
  configText: "{\n  \"model_type\": \"llama\",\n  \"name\": \"café \\\"q\\\" \\\\ \\t  \"\n}\n",
  tensors: [
    { name: "token_embd.weight", offset: 1024, sizeBytes: 512, sha256: "c".repeat(64) },
    { name: "blk.0.attn_q.weight", offset: 1536, sizeBytes: 256, sha256: "d".repeat(64) },
  ],
  manifestId: "a0115e84283227e49acd1173764a61063f6e5f6b153ddbcde038d0ca36441c5f",
} as const;

describe("GGUF tensor manifest", () => {
  it("computes the same identity as the Python node", () => {
    expect(ggufTensorManifestIdentity(PYTHON_MANIFEST)).toBe(PYTHON_MANIFEST.manifestId);
    expect(ggufTensorManifestSchema.parse(PYTHON_MANIFEST).manifestId).toBe(PYTHON_MANIFEST.manifestId);
  });

  it("rejects any change to the manifest content", () => {
    const changed = structuredClone(PYTHON_MANIFEST) as unknown as { tensors: Array<{ sha256: string }> };
    changed.tensors[0]!.sha256 = "e".repeat(64);
    expect(() => ggufTensorManifestSchema.parse(changed)).toThrow("gguf_tensor_manifest_identity_mismatch");
  });

  it("rejects duplicated or out-of-bounds tensors and invalid config", () => {
    const seal = (value: Record<string, unknown>) => ({ ...value, manifestId: ggufTensorManifestIdentity(value) });
    const duplicated = structuredClone(PYTHON_MANIFEST) as unknown as Record<string, unknown> & { tensors: Array<{ name: string }> };
    duplicated.tensors[1]!.name = "token_embd.weight";
    expect(() => ggufTensorManifestSchema.parse(seal(duplicated))).toThrow("gguf_tensor_manifest_tensor_is_duplicated");

    const outside = structuredClone(PYTHON_MANIFEST) as unknown as Record<string, unknown> & { tensors: Array<{ offset: number }> };
    outside.tensors[1]!.offset = 4000;
    expect(() => ggufTensorManifestSchema.parse(seal(outside))).toThrow("gguf_tensor_manifest_tensor_is_outside_the_artifact");

    const config = { ...structuredClone(PYTHON_MANIFEST), configText: "[1, 2]" };
    expect(() => ggufTensorManifestSchema.parse(seal(config))).toThrow("gguf_tensor_manifest_config_is_invalid");
  });
});

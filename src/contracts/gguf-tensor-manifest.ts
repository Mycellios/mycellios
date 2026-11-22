import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Tensor manifest of a complete GGUF artifact, produced by
 * `python -m distributed_runtime.native_gguf_remote manifest`. Nodes use it to
 * fetch and verify only their stage's tensors. Its identity is the SHA-256 of
 * the canonical JSON that Python writes (`native_gguf._canonical_json`):
 * sorted keys by code point, no whitespace, UTF-8, integers only.
 */
export const GGUF_TENSOR_MANIFEST_SCHEMA = "gdlp-gguf-tensor-manifest/1" as const;

const hexDigest = z.string().regex(/^[0-9a-f]{64}$/);
const positiveInteger = z.number().int().positive().safe();

export const ggufTensorManifestSchema = z.object({
  schema: z.literal(GGUF_TENSOR_MANIFEST_SCHEMA),
  source: z.object({ sha256: hexDigest, sizeBytes: positiveInteger }).strict(),
  header: z.object({ sizeBytes: positiveInteger, sha256: hexDigest }).strict(),
  architecture: z.string().min(1).max(64),
  configText: z.string().min(2).max(1_048_576),
  tensors: z.array(z.object({
    name: z.string().min(1).max(512),
    offset: z.number().int().nonnegative().safe(),
    sizeBytes: positiveInteger,
    sha256: hexDigest,
  }).strict()).min(1).max(100_000),
  manifestId: hexDigest,
}).strict().superRefine((manifest, context) => {
  if (manifest.manifestId !== ggufTensorManifestIdentity(manifest)) {
    context.addIssue({ code: "custom", message: "gguf_tensor_manifest_identity_mismatch", path: ["manifestId"] });
  }
  const names = new Set<string>();
  for (const [index, tensor] of manifest.tensors.entries()) {
    if (names.has(tensor.name)) {
      context.addIssue({ code: "custom", message: "gguf_tensor_manifest_tensor_is_duplicated", path: ["tensors", index] });
    }
    names.add(tensor.name);
    if (tensor.offset < manifest.header.sizeBytes || tensor.offset + tensor.sizeBytes > manifest.source.sizeBytes) {
      context.addIssue({ code: "custom", message: "gguf_tensor_manifest_tensor_is_outside_the_artifact", path: ["tensors", index] });
    }
  }
  let config: unknown;
  try {
    config = JSON.parse(manifest.configText);
  } catch {
    config = undefined;
  }
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    context.addIssue({ code: "custom", message: "gguf_tensor_manifest_config_is_invalid", path: ["configText"] });
  }
});

export type GgufTensorManifest = z.infer<typeof ggufTensorManifestSchema>;

/** SHA-256 of the manifest without its id, canonicalized exactly as Python does. */
export function ggufTensorManifestIdentity(manifest: Record<string, unknown>): string {
  const { manifestId: _manifestId, ...content } = manifest;
  return createHash("sha256").update(pythonCanonicalJson(content), "utf8").digest("hex");
}

function pythonCanonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("gguf_tensor_manifest_number_is_not_an_integer");
    return String(value);
  }
  if (typeof value === "string") return pythonJsonString(value);
  if (Array.isArray(value)) return `[${value.map(pythonCanonicalJson).join(",")}]`;
  if (typeof value === "object") {
    // Python sorts keys by code point; the default sort compares UTF-16 code
    // units, which agrees for the keys a manifest can contain.
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, child]) => `${pythonJsonString(key)}:${pythonCanonicalJson(child)}`).join(",")}}`;
  }
  throw new Error("gguf_tensor_manifest_value_is_not_json");
}

/** `json.dumps(value, ensure_ascii=False)` for one string. */
function pythonJsonString(value: string): string {
  let result = "\"";
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (character === "\"") result += "\\\"";
    else if (character === "\\") result += "\\\\";
    else if (character === "\n") result += "\\n";
    else if (character === "\r") result += "\\r";
    else if (character === "\t") result += "\\t";
    else if (character === "\b") result += "\\b";
    else if (character === "\f") result += "\\f";
    else if (code < 0x20) result += `\\u${code.toString(16).padStart(4, "0")}`;
    else result += character;
  }
  return `${result}"`;
}

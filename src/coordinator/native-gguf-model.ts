import { ggufTensorManifestSchema, type GgufTensorManifest } from "../contracts/gguf-tensor-manifest.js";
import { compileGgufModelProfile } from "../distribution/gguf-model-profile.js";
import { NATIVE_GGUF_SOURCE_SCHEMA } from "../distribution/native-gguf-source.js";
import type { EngineActivationAuthority } from "./engine-activation-authority.js";
import type { NativeGgufModel } from "./model-activation-manager.js";

const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 60_000;

export type ManifestFetcher = (url: string, maxBytes: number) => Promise<string>;

/**
 * Resolve the certified GGUF of the engine activation authority for the one
 * model it certifies. The tensor manifest is fetched once, accepted only with
 * the pinned id and artifact identity, and then kept in memory. Any other
 * model keeps its safetensors route.
 */
export function createNativeGgufModelResolver(
  authority: EngineActivationAuthority,
  fetchManifest: ManifestFetcher = fetchBoundedText,
): (model: { id: string; source: string; revision: string | null }) => Promise<NativeGgufModel | null> {
  const artifact = authority.artifact;
  let manifest: Promise<GgufTensorManifest> | null = null;
  return async (model) => {
    if (!artifact || model.source !== authority.descriptor.model.modelId) return null;
    manifest ??= loadManifest(artifact, fetchManifest).catch((error: unknown) => {
      manifest = null;
      throw error;
    });
    const verified = await manifest;
    return {
      profile: compileGgufModelProfile(verified, {
        modelId: model.source,
        canonicalSource: `hf://${authority.descriptor.model.modelId}`,
        canonicalRevision: authority.descriptor.model.revision,
      }),
      source: {
        schema: NATIVE_GGUF_SOURCE_SCHEMA,
        artifactUrl: artifact.url,
        artifactSha256: artifact.sha256,
        artifactSizeBytes: artifact.sizeBytes,
        tensorManifestUrl: artifact.tensorManifestUrl,
        tensorManifestId: artifact.tensorManifestId,
        executor: artifact.executor,
      },
    };
  };
}

async function loadManifest(
  artifact: NonNullable<EngineActivationAuthority["artifact"]>,
  fetchManifest: ManifestFetcher,
): Promise<GgufTensorManifest> {
  let document: unknown;
  try {
    document = JSON.parse(await fetchManifest(artifact.tensorManifestUrl, MAX_MANIFEST_BYTES));
  } catch (error) {
    throw new Error(`gguf_tensor_manifest_unavailable:${error instanceof Error ? error.message : "unknown"}`);
  }
  const parsed = ggufTensorManifestSchema.safeParse(document);
  if (!parsed.success) throw new Error("gguf_tensor_manifest_is_invalid");
  const manifest = parsed.data;
  if (manifest.manifestId !== artifact.tensorManifestId) {
    throw new Error("gguf_tensor_manifest_is_not_the_pinned_one");
  }
  if (manifest.source.sha256 !== artifact.sha256 || manifest.source.sizeBytes !== artifact.sizeBytes) {
    throw new Error("gguf_tensor_manifest_names_another_artifact");
  }
  return manifest;
}

async function fetchBoundedText(url: string, maxBytes: number): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow" });
  if (response.status !== 200 || !response.body) throw new Error(`http_${response.status}`);
  if (!response.url.startsWith("https://")) throw new Error("redirect_left_https");
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new Error("manifest_too_large");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("manifest_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

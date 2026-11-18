import { createHash } from "node:crypto";
import { MAX_MODEL_CONTEXT_WINDOW, MAX_MODEL_MAX_TOKENS } from "@rakazo/contracts";
import { readBoundedJsonResponse } from "@rakazo/core";
import { createOpenAiCompatibleFetch } from "./pi-openai-compatible-provider.js";

/** Limits that one Mycellios catalog route publishes for admission planning. */
export interface MycelliosModelLimits {
  contextWindow: number;
  maxTokens?: number;
}

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { expiresAt: number; limits: Promise<Map<string, MycelliosModelLimits>> }>();

const tokenCount = (value: unknown, max: number): number | undefined =>
  Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= max
    ? (value as number)
    : undefined;

/** Per-model limits from the canonical catalog; models without them are omitted. */
export function parseMycelliosModelLimits(body: unknown): Map<string, MycelliosModelLimits> {
  const limits = new Map<string, MycelliosModelLimits>();
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) return limits;
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const contextWindow = tokenCount(row.context_length, MAX_MODEL_CONTEXT_WINDOW);
    if (typeof row.id !== "string" || contextWindow === undefined) continue;
    const maxTokens = tokenCount(row.max_output_tokens, MAX_MODEL_MAX_TOKENS);
    limits.set(row.id, {
      contextWindow,
      ...(maxTokens !== undefined && maxTokens < contextWindow ? { maxTokens } : {}),
    });
  }
  return limits;
}

/**
 * Read-only catalog lookup, cached briefly per endpoint and key. Failures yield
 * no limits so the saved connection values still apply; this never calls a model.
 */
export async function readMycelliosModelLimits(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  options: { fetch?: typeof fetch; signal?: AbortSignal; now?: number } = {},
): Promise<MycelliosModelLimits | undefined> {
  const now = options.now ?? Date.now();
  const key = `${baseUrl}\n${createHash("sha256").update(apiKey).digest("hex")}`;
  let entry = cache.get(key);
  if (!entry || entry.expiresAt <= now) {
    const signal = AbortSignal.any([
      AbortSignal.timeout(5_000),
      ...(options.signal ? [options.signal] : []),
    ]);
    const limits = (async () => {
      const response = await createOpenAiCompatibleFetch(options.fetch)(
        `${baseUrl.replace(/\/+$/, "")}/models`,
        {
          method: "GET",
          redirect: "error",
          cache: "no-store",
          signal,
          headers: {
            authorization: `Bearer ${apiKey}`,
            accept: "application/json",
            "x-mycellios-funding": "contribution-credits",
          },
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("Mycellios model catalog is temporarily unavailable.");
      }
      return parseMycelliosModelLimits(await readBoundedJsonResponse(response, 4_194_304, signal));
    })();
    entry = { expiresAt: now + TTL_MS, limits };
    cache.set(key, entry);
    // A failed read is retried on the next run instead of being cached.
    limits.catch(() => {
      if (cache.get(key) === entry) cache.delete(key);
    });
  }
  try {
    return (await entry.limits).get(modelId);
  } catch {
    return undefined;
  }
}

/** Test seam: forget cached catalog reads. */
export function clearMycelliosModelLimits(): void {
  cache.clear();
}

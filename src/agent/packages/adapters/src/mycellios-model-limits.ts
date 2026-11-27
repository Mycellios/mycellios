import { createHash } from "node:crypto";
import { MAX_MODEL_CONTEXT_WINDOW, MAX_MODEL_MAX_TOKENS } from "@mycellios/contracts";
import { readBoundedJsonResponse } from "@mycellios/core";
import { createOpenAiCompatibleFetch } from "./pi-openai-compatible-provider.js";

/** Limits that one Mycellios catalog route publishes for admission planning. */
export interface MycelliosModelLimits {
  contextWindow: number;
  maxTokens?: number;
}

const TTL_MS = 5 * 60_000;
interface MycelliosCatalogRead {
  limits: Map<string, MycelliosModelLimits>;
  /** Every id the account catalog lists, with or without published limits. */
  ids: Set<string>;
}
const cache = new Map<string, { expiresAt: number; limits: Promise<MycelliosCatalogRead> }>();
/** The coordinator can answer slowly under load; a run keeps the last good read instead. */
const READ_TIMEOUT_MS = 15_000;
const LAST_GOOD_MAX_AGE_MS = 6 * 60 * 60_000;
const lastGood = new Map<string, { at: number; read: MycelliosCatalogRead }>();

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
  try {
    return (await readMycelliosCatalog(baseUrl, apiKey, options)).limits.get(modelId);
  } catch {
    return undefined;
  }
}

/**
 * Whether the account catalog currently lists `modelId`. A saved enabled id can outlive the
 * route that served it; undefined means the catalog could not be read, so nothing is inferred.
 */
export async function mycelliosCatalogServes(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  options: { fetch?: typeof fetch; signal?: AbortSignal; now?: number } = {},
): Promise<boolean | undefined> {
  try {
    return (await readMycelliosCatalog(baseUrl, apiKey, options)).ids.has(modelId);
  } catch {
    return undefined;
  }
}

function readMycelliosCatalog(
  baseUrl: string,
  apiKey: string,
  options: { fetch?: typeof fetch; signal?: AbortSignal; now?: number },
): Promise<MycelliosCatalogRead> {
  const now = options.now ?? Date.now();
  const key = `${baseUrl}\n${createHash("sha256").update(apiKey).digest("hex")}`;
  let entry = cache.get(key);
  if (!entry || entry.expiresAt <= now) {
    const signal = AbortSignal.any([
      AbortSignal.timeout(READ_TIMEOUT_MS),
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
      const body = await readBoundedJsonResponse(response, 4_194_304, signal);
      const data = body && typeof body === "object" ? (body as { data?: unknown }).data : undefined;
      const ids = new Set(
        (Array.isArray(data) ? data : []).flatMap((row) =>
          row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string"
            ? [(row as { id: string }).id]
            : [],
        ),
      );
      const read = { limits: parseMycelliosModelLimits(body), ids };
      lastGood.set(key, { at: Date.now(), read });
      return read;
    })();
    // A slow or failed read falls back to the last good one, so a coordinator hiccup cannot
    // shrink every model to the connection-wide default window and fail the turn.
    const guarded = limits.catch((error: unknown) => {
      const previous = lastGood.get(key);
      if (previous && Date.now() - previous.at < LAST_GOOD_MAX_AGE_MS) return previous.read;
      throw error;
    });
    entry = { expiresAt: now + TTL_MS, limits: guarded };
    cache.set(key, entry);
    // A failed read is retried on the next run instead of being cached.
    limits.catch(() => {
      if (cache.get(key) === entry) cache.delete(key);
    });
  }
  return entry.limits;
}

/** Test seam: forget cached catalog reads. */
export function clearMycelliosModelLimits(): void {
  cache.clear();
  lastGood.clear();
}

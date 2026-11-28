import type { Api, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";

const ANTHROPIC_PROVIDER = "anthropic";

/** Validate the installed adapter's protocol seam, never infer capabilities from a model name.
 * Retention is a request preference; it cannot promise cache reuse or provider billing behavior.
 * Omitted modes use the audited short default, except one hour on Anthropic's own API;
 * connection controls override SDK environment defaults.
 */
export function resolvePiCacheRetention(
  model: Pick<Model<Api>, "api" | "compat"> & { provider?: string },
  requested: SimpleStreamOptions["cacheRetention"],
): SimpleStreamOptions["cacheRetention"] {
  if (requested === undefined) {
    // Anthropic's own API keeps a one-hour prefix for twice the base write price and a tenth
    // of the input price on every read, and the reservation and settlement price it
    // (cacheWriteRetention "1h"). Runs that start more than five minutes apart, such as a
    // routine every 30 minutes or a chat after a pause, then read their ~28k-token prefix
    // instead of writing it again. Compatible endpoints that merely speak this protocol keep
    // the short default: they may not accept the one-hour marker.
    if (
      model.api === "anthropic-messages" &&
      model.provider === ANTHROPIC_PROVIDER &&
      !(model.compat && "supportsLongCacheRetention" in model.compat && model.compat.supportsLongCacheRetention === false)
    )
      return "long";
    return ["openai-responses", "openai-completions", "anthropic-messages"].includes(model.api)
      ? "short"
      : undefined;
  }
  const compat = model.compat;
  const explicitMode =
    compat && "supportsExplicitPromptCacheMode" in compat
      ? compat.supportsExplicitPromptCacheMode
      : undefined;
  const longRetention =
    compat && "supportsLongCacheRetention" in compat
      ? compat.supportsLongCacheRetention
      : undefined;
  const cacheControlFormat =
    compat && "cacheControlFormat" in compat ? compat.cacheControlFormat : undefined;
  if (model.api === "openai-responses") {
    if (requested === "short") return requested;
    if (requested === "none" && explicitMode === true) return requested;
    if (requested === "long" && longRetention === true) return requested;
  } else if (
    model.api === "anthropic-messages" ||
    (model.api === "openai-completions" && cacheControlFormat === "anthropic")
  ) {
    // Audited Anthropic marker controls omit markers for none and request ttl:1h for long.
    if (requested !== "long" || longRetention !== false) return requested;
  } else if (model.api === "openai-completions") {
    if (requested === "short") return requested;
    // Chat Completions cannot emit the newer explicit-mode/30m Responses protocol.
    if (requested === "long" && longRetention === true && explicitMode !== true) return requested;
  }
  throw new Error(
    "Unsupported prompt-cache retention mode. Omit retentionMode to use cache timing predictions only.",
  );
}

/** Only an explicit audited Anthropic long marker requests one-hour cache writes. */
export function requestedPiCacheWriteRetention(
  model: Pick<Model<Api>, "api" | "compat">,
  requested: SimpleStreamOptions["cacheRetention"],
): "1h" | undefined {
  const compat = model.compat;
  return requested === "long" &&
    (model.api === "anthropic-messages" ||
      (model.api === "openai-completions" &&
        compat &&
        "cacheControlFormat" in compat &&
        compat.cacheControlFormat === "anthropic"))
    ? "1h"
    : undefined;
}

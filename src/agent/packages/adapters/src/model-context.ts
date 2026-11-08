import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { collapseSystemMessages, normalizeContext } from "@earendil-works/pi-ai";
import { isOpenAiCompatibleProvider } from "@rakazo/contracts";
import type { ContextBudget } from "./context-selection.js";
import { ContextBudgetError, estimateContextTokens } from "./context-selection.js";

export const MIN_REDUCED_OUTPUT_TOKENS = 256;
export const CONTEXT_ADMISSION_HEADROOM = 128;

/** A configured output limit is a ceiling. Preserve required input before spend. */
export function prepareModelContextBudget(
  context: Context,
  model: Model<Api>,
  maxTokens: number | undefined,
  prepare?: (context: Context, model: Model<Api>) => Context,
): { context: Context; maxTokens?: number } {
  if (!prepare) return { context };
  const cap = Math.min(
    maxTokens ?? model.maxTokens,
    model.maxTokens,
    Math.max(1, Math.floor(model.contextWindow / 4)),
  );
  const admissionModel = Number.isSafeInteger(cap) && cap >= 1 && cap < model.maxTokens
    ? { ...model, maxTokens: cap }
    : model;
  try {
    const prepared = prepare(context, admissionModel);
    return Number.isSafeInteger(cap) && cap >= 1 && cap !== (maxTokens ?? model.maxTokens)
      ? { context: prepared, maxTokens: cap }
      : { context: prepared };
  } catch (error) {
    if (
      !(error instanceof ContextBudgetError) ||
      model.reasoning ||
      !Number.isSafeInteger(cap) ||
      cap <= MIN_REDUCED_OUTPUT_TOKENS
    )
      throw error;
    const excess = error.estimatedTokens - error.availableTokens;
    const reduced = Math.floor(cap - excess - CONTEXT_ADMISSION_HEADROOM);
    if (!Number.isSafeInteger(reduced) || reduced < MIN_REDUCED_OUTPUT_TOKENS || reduced >= cap)
      throw error;
    // Retry only local admission. No input, tool permissions or saved settings
    // are changed, and no provider request or credit hold has happened yet.
    return { context: prepare(context, { ...model, maxTokens: reduced }), maxTokens: reduced };
  }
}

/**
 * Provider-neutral estimate for an unknown tokenizer, including tool schemas and
 * message framing. Image blocks use the adapter's dimension-based planning estimate
 * when one is supplied and a serialized byte count otherwise.
 */
export function estimateModelContextTokens(
  context: Context,
  imageTokens?: ContextBudget["imageTokens"],
): number {
  return estimateContextTokens(context, imageTokens) + 240;
}

/** Match the compatible transport without mutating stored transcript/checkpoints. */
export function modelContextForAdmission(context: Context, model: Model<Api>): Context {
  // Chat-completions transports replay system/tool deltas into one current
  // declaration. Budget that same representation: removed schemas in restored
  // checkpoints are not mandatory input and must not wedge a small-window run.
  const compat = model.compat as Model<"openai-completions">["compat"];
  if (
    isOpenAiCompatibleProvider(model.provider) &&
    !model.reasoning &&
    model.api === "openai-completions" &&
    compat?.supportsMidConvoSystemMessages !== true
  ) {
    return collapseSystemMessages(normalizeContext(context));
  }
  return context;
}

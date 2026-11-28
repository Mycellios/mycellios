import type { Api, Model, Models } from "@earendil-works/pi-ai";
import { DEFAULT_MODEL_CONTEXT_WINDOW } from "@mycellios/contracts";
import type { ModelsDevModel, ModelsDevSnapshot } from "./models-dev.js";
import { modelsDevCatalog } from "./models-dev.js";

/** Models endpoints often mix chat models with tools and media endpoints. */
export function isChatModelId(id: string): boolean {
  return (
    /^[\x21-\x7e]{1,1024}$/.test(id) &&
    !/(embed|(?:^|[-/_])tts(?:[-/_]|$)|whisper|transcrib|audio|realtime|dall-e|gpt-image|imagen|moderation|rerank|stable-diffusion|\bflux\b|image|text-to-speech|speech-to-text|\bsora\b|\bveo\b|video|\bocr\b|davinci|babbage|turbo-instruct|computer-use)/i.test(
      id,
    )
  );
}

/** Pi providers whose models.dev entries live under another service name. */
const MODELS_DEV_SERVICE: Readonly<Record<string, string>> = {
  // ChatGPT sign-in runs OpenAI's models; the account's own catalog decides which.
  "openai-codex": "openai",
};

/** The models.dev service that describes a Pi provider's models, when the catalog has one. */
export function modelsDevService(
  provider: string,
  snapshot: ModelsDevSnapshot | undefined,
): string | undefined {
  const service = MODELS_DEV_SERVICE[provider] ?? provider;
  return snapshot?.knowsService(service) ? service : undefined;
}

/** models.dev's own entry for this provider's model. */
export function modelsDevEntry(
  provider: string,
  id: string,
  snapshot: ModelsDevSnapshot | undefined = modelsDevCatalog.current(),
): ModelsDevModel | undefined {
  const service = modelsDevService(provider, snapshot);
  return service ? snapshot?.model(service, id) : undefined;
}

/**
 * The context window models.dev lists for this provider's own model, or none. A provider whose
 * models.dev entries live under another service (ChatGPT sign-in) runs the model on its own
 * backend with its own limits, so the other service's figure is not reported for it.
 */
export function modelsDevContextWindow(
  provider: string,
  id: string,
  snapshot: ModelsDevSnapshot | undefined = modelsDevCatalog.current(),
): number | undefined {
  if (MODELS_DEV_SERVICE[provider]) return undefined;
  return modelsDevEntry(provider, id, snapshot)?.contextWindow;
}

const OPENAI_APIS = ["openai-completions", "openai-responses", "openai-codex-responses"];

function safeBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.protocol === "https:" && !url.username && !url.password && !/[{}]/.test(url.href);
  } catch {
    return false;
  }
}

/** The sibling sharing the longest id prefix: the closest relative in the provider's list. */
function closest(siblings: readonly Model<Api>[], id: string): Model<Api> {
  const prefixLength = (other: string) => {
    let n = 0;
    while (n < id.length && id[n] === other[n]) n++;
    return n;
  };
  return [...siblings].sort((a, b) => prefixLength(b.id) - prefixLength(a.id))[0]!;
}

/**
 * The provider's route for a models.dev model that its bundled list lacks. The provider's models
 * must share one protocol and HTTPS host; where they use several, a model of the same models.dev
 * family decides. The new model never moves to another provider or host.
 */
function modelsDevRoute(
  all: readonly Model<Api>[],
  listed: ModelsDevModel,
  snapshot: ModelsDevSnapshot,
): Model<Api> | undefined {
  const routes = (models: readonly Model<Api>[]) =>
    new Set(models.map((model) => `${model.api} ${model.baseUrl}`));
  let candidates = all;
  if (routes(candidates).size !== 1 && listed.family) {
    candidates = all.filter(
      (model) =>
        snapshot.model(listed.service, model.id)?.family === listed.family ||
        snapshot.modelByName(model.id)?.family === listed.family,
    );
  }
  if (candidates.length === 0 || routes(candidates).size !== 1) return undefined;
  const sibling = closest(candidates, listed.id);
  return safeBaseUrl(sibling.baseUrl) ? sibling : undefined;
}

/**
 * models.dev's description of the model. Limits and prices come only from the provider's own
 * entry: a subscription backend, or another service of the same model, can set its own.
 */
function withModelsDev(model: Model<Api>, listed: ModelsDevModel, own: boolean): Model<Api> {
  return {
    ...model,
    name: listed.name,
    reasoning: listed.reasoning,
    input: listed.images ? ["text", "image"] : ["text"],
    ...(own && listed.contextWindow ? { contextWindow: listed.contextWindow } : {}),
    ...(own && listed.maxOutput ? { maxTokens: listed.maxOutput } : {}),
    ...(own && listed.cost ? { cost: listed.cost } : {}),
  };
}

/**
 * A deterministic fallback shared by listing and execution for a model the bundled list lacks;
 * never changes provider or host. models.dev describes the model when it lists it for this
 * provider, as an updated Pi would; otherwise an OpenAI-protocol sibling stands in.
 */
export function liveModelSibling(
  models: Models,
  provider: string,
  id: string,
  snapshot: ModelsDevSnapshot | undefined = modelsDevCatalog.current(),
): Model<Api> | undefined {
  if (!isChatModelId(id)) return undefined;
  const all = models.getProvider?.(provider)?.getModels() ?? [];
  const listed = modelsDevEntry(provider, id, snapshot);
  if (listed && snapshot) {
    const route = modelsDevRoute(all, listed, snapshot);
    if (route) {
      return withModelsDev({ ...route, id }, listed, !MODELS_DEV_SERVICE[provider]);
    }
  }
  const siblings = all.filter((model) => OPENAI_APIS.includes(model.api));
  const urls = new Set(siblings.map((model) => model.baseUrl));
  if (urls.size !== 1 || siblings.length === 0) return undefined;
  if (!safeBaseUrl(siblings[0]!.baseUrl)) return undefined;
  const sibling = closest(siblings, id);
  // Only a date/alias variant proves the same family and its capabilities.
  const family = (value: string) => value.replace(/-(?:\d{4}-\d{2}-\d{2}|\d{4,8}|latest)$/, "");
  const sameFamily = family(id) === family(sibling.id);
  const fallback: Model<Api> = {
    ...sibling,
    id,
    name: id,
    reasoning: sameFamily && sibling.reasoning,
    input: sameFamily ? [...sibling.input] : ["text"],
    // An unrelated sibling's window says nothing about this model's.
    contextWindow: sameFamily ? sibling.contextWindow : DEFAULT_MODEL_CONTEXT_WINDOW,
  };
  // A live list can name a model that models.dev knows under its maker's name only.
  const described = listed ?? snapshot?.modelByName(id);
  if (!described) return fallback;
  return withModelsDev(fallback, described, described === listed && !MODELS_DEV_SERVICE[provider]);
}

/** Whether models.dev lists this model for the provider, so an updated Pi would run it. */
export function modelsDevListsModel(
  provider: string,
  id: string,
  snapshot: ModelsDevSnapshot | undefined = modelsDevCatalog.current(),
): boolean {
  return Boolean(modelsDevEntry(provider, id, snapshot)?.agentReady && isChatModelId(id));
}

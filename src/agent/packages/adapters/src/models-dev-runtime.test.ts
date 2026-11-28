import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { afterEach, describe, expect, it } from "vitest";
import { modelsDevCatalog, parseModelsDev } from "./models-dev.js";
import { listAvailablePiCatalog } from "./pi-catalog-availability.js";
import { applyModelsDevCatalog, liveCatalogEntry } from "./pi-live-catalog.js";
import { liveModelSibling, modelsDevListsModel } from "./pi-live-model.js";
import { listPiCatalog } from "./pi-models.js";

const models = builtinModels();

const snapshot = parseModelsDev({
  anthropic: {
    models: {
      "claude-fable-9": {
        name: "Claude Fable 9",
        family: "claude-fable",
        release_date: "2026-11-15",
        tool_call: true,
        reasoning: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 2_000_000, output: 200_000 },
        cost: { input: 12, output: 60 },
      },
      "claude-legacy": { name: "Legacy", release_date: "2024-01-01", status: "deprecated" },
    },
  },
  openai: {
    models: {
      "gpt-6.2-sol": {
        name: "GPT-6.2 Sol",
        family: "gpt-sol",
        release_date: "2026-11-14",
        tool_call: true,
        reasoning: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_050_000, output: 128_000 },
        cost: { input: 3, output: 15 },
      },
    },
  },
})!;

afterEach(() => modelsDevCatalog.install(undefined));

describe("models.dev models that the bundled Pi list lacks", () => {
  it("runs a listed model on the provider's own protocol and host", () => {
    const model = liveModelSibling(models, "anthropic", "claude-fable-9", snapshot);
    expect(model).toMatchObject({
      id: "claude-fable-9",
      name: "Claude Fable 9",
      provider: "anthropic",
      api: "anthropic-messages",
      baseUrl: "https://api.anthropic.com",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 2_000_000,
      maxTokens: 200_000,
      cost: { input: 12, output: 60, cacheRead: 0, cacheWrite: 0 },
    });
  });

  it("does not invent a non-OpenAI model that models.dev does not list", () => {
    expect(liveModelSibling(models, "anthropic", "claude-unknown-9", snapshot)).toBeUndefined();
    expect(liveModelSibling(models, "anthropic", "claude-fable-9")).toBeUndefined();
    expect(modelsDevListsModel("anthropic", "claude-fable-9", snapshot)).toBe(true);
    expect(modelsDevListsModel("anthropic", "claude-legacy", snapshot)).toBe(false);
    expect(modelsDevListsModel("anthropic", "claude-fable-9", undefined)).toBe(false);
  });

  it("names a ChatGPT model from OpenAI's entry without taking API limits or prices", () => {
    const model = liveModelSibling(models, "openai-codex", "gpt-6.2-sol", snapshot)!;
    const sibling = models.getProvider("openai-codex")!.getModels()[0]!;
    expect(model.name).toBe("GPT-6.2 Sol");
    expect(model.input).toEqual(["text", "image"]);
    expect(model.api).toBe(sibling.api);
    expect(model.baseUrl).toBe(sibling.baseUrl);
    expect(model.contextWindow).not.toBe(1_050_000);
  });

  it("lists models.dev additions for connected providers only, with readable names", () => {
    modelsDevCatalog.install(snapshot);
    const auth = {
      byProvider: { anthropic: "api_key" as const, "openai-codex": "oauth" as const },
      byModel: {},
    };
    const base = listAvailablePiCatalog(auth.byProvider, auth.byModel);
    const merged = applyModelsDevCatalog(base, auth, snapshot);
    const added = merged.filter(
      (entry) => !base.some((other) => other.provider === entry.provider && other.id === entry.id),
    );
    expect(added.map((entry) => `${entry.provider}:${entry.id}`)).toEqual([
      "anthropic:claude-fable-9",
    ]);
    expect(added[0]).toMatchObject({ label: "Claude Fable 9", images: true, live: true });
    // A new model sits with its provider's other models.
    const anthropic = merged.filter((entry) => entry.provider === "anthropic");
    expect(anthropic.at(-1)?.id).toBe("claude-fable-9");
  });

  it("leaves the list alone without models.dev and for the managed provider", () => {
    const auth = { byProvider: { anthropic: "api_key" as const }, byModel: {} };
    const base = listAvailablePiCatalog(auth.byProvider, auth.byModel);
    expect(applyModelsDevCatalog(base, auth, undefined)).toEqual(base);
    expect(applyModelsDevCatalog(base, { ...auth, managedProvider: "anthropic" }, snapshot)).toEqual(
      base,
    );
  });

  it("reports models.dev's context window for the provider's own model and never guesses one", () => {
    modelsDevCatalog.install(snapshot);
    expect(liveCatalogEntry("anthropic", "claude-fable-9")?.contextWindow).toBe(2_000_000);
    // ChatGPT sign-in runs on its own backend, so OpenAI's API figure is not reported for it.
    expect(liveCatalogEntry("openai-codex", "gpt-6.2-sol")).not.toHaveProperty("contextWindow");
    // A sibling's bundled window says nothing about a model nobody described.
    modelsDevCatalog.install(undefined);
    expect(listPiCatalog().find((entry) => entry.provider === "openai-codex")?.contextWindow).toBeGreaterThan(0);
    expect(liveCatalogEntry("openai-codex", "gpt-future-chat")).not.toHaveProperty("contextWindow");
  });

  it("gives a ChatGPT account's live model its models.dev name", () => {
    modelsDevCatalog.install(snapshot);
    expect(liveCatalogEntry("openai-codex", "gpt-6.2-sol")).toMatchObject({
      label: "GPT-6.2 Sol",
      images: true,
    });
  });
});

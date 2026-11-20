import { describe, expect, it } from "vitest";
import { applyModelListing } from "./model-listing.js";
import { parseModelsDev } from "./models-dev.js";

const NOW = Date.parse("2026-11-18T12:00:00Z");

type Spec = { family: string; date: string; ready?: boolean };

function snapshot(services: Record<string, Record<string, Spec>>) {
  return parseModelsDev(
    Object.fromEntries(
      Object.entries(services).map(([service, models]) => [
        service,
        {
          models: Object.fromEntries(
            Object.entries(models).map(([id, spec]) => [
              id,
              {
                family: spec.family,
                release_date: spec.date,
                tool_call: spec.ready !== false,
              },
            ]),
          ),
        },
      ]),
    ),
  )!;
}

const listing = (entries: { provider: string; id: string; listing?: string }[]) =>
  Object.fromEntries(entries.map((entry) => [entry.id, entry.listing ?? "main"]));

describe("applyModelListing", () => {
  it("leaves the list unchanged without models.dev", () => {
    const entries = [{ provider: "anthropic", id: "claude-x" }];
    expect(applyModelListing(entries, undefined)).toEqual(entries);
  });

  it("folds only superseded models of a family in a short list and marks recent releases", () => {
    const catalog = snapshot({
      anthropic: {
        "claude-opus-5": { family: "claude-opus", date: "2026-03-01" },
        "claude-opus-5-5": { family: "claude-opus", date: "2026-11-15" },
        "claude-haiku-4-5": { family: "claude-haiku", date: "2025-10-15" },
      },
    });
    const entries = ["claude-opus-5", "claude-opus-5-5", "claude-haiku-4-5", "claude-custom"].map(
      (id) => ({ provider: "anthropic", id }),
    );
    expect(listing(applyModelListing(entries, catalog, { now: NOW }))).toEqual({
      "claude-opus-5": "older",
      "claude-opus-5-5": "new",
      "claude-haiku-4-5": "main",
      "claude-custom": "main",
    });
  });

  it("keeps saved choices and recommended models in the main list", () => {
    const catalog = snapshot({
      anthropic: {
        "claude-opus-5": { family: "claude-opus", date: "2026-03-01" },
        "claude-opus-5-5": { family: "claude-opus", date: "2026-11-15" },
        "claude-opus-4": { family: "claude-opus", date: "2025-03-01" },
      },
    });
    const entries = [
      { provider: "anthropic", id: "claude-opus-5" },
      { provider: "anthropic", id: "claude-opus-5-5" },
      { provider: "anthropic", id: "claude-opus-4", recommended: true },
    ];
    const listed = applyModelListing(entries, catalog, {
      keep: new Set(["anthropic:claude-opus-5"]),
      now: NOW,
    });
    expect(listing(listed)).toEqual({
      "claude-opus-5": "main",
      "claude-opus-5-5": "new",
      "claude-opus-4": "main",
    });
  });

  it("shows a long list's newest current families and folds past generations", () => {
    const models: Record<string, Spec> = {};
    for (let index = 0; index < 13; index += 1) {
      models[`fam${index}-1`] = { family: `fam${index}`, date: "2026-06-01" };
    }
    models["fam0-2"] = { family: "fam0", date: "2026-09-01" };
    models["ancient-1"] = { family: "ancient", date: "2025-01-01" };
    models["broken-1"] = { family: "broken", date: "2026-10-01", ready: false };
    const catalog = snapshot({ openai: models });
    const entries = Object.keys(models).map((id) => ({ provider: "openai", id }));
    const result = listing(applyModelListing(entries, catalog, { now: NOW }));
    expect(result["fam0-2"]).toBe("main");
    expect(result["fam0-1"]).toBe("older");
    expect(result["ancient-1"]).toBe("older");
    expect(result["broken-1"]).toBe("older");
    // Twelve families fit; the thirteenth with the same date falls off the end.
    expect(Object.values(result).filter((value) => value === "main")).toHaveLength(12);
  });

  it("gives a newer uncatalogued version its family so it leads the list", () => {
    const catalog = snapshot({
      xai: {
        "grok-4-7": { family: "grok", date: "2026-09-01" },
        "grok-4-6": { family: "grok", date: "2026-05-01" },
      },
    });
    const entries = ["grok-4-6", "grok-4-7", "grok-4.8"].map((id) => ({ provider: "xai", id }));
    expect(listing(applyModelListing(entries, catalog, { now: NOW }))).toEqual({
      "grok-4-6": "older",
      "grok-4-7": "older",
      "grok-4.8": "main",
    });
  });

  it("reads a ChatGPT model through OpenAI's entry and skips the managed provider", () => {
    const catalog = snapshot({
      openai: {
        "gpt-6-sol": { family: "gpt-sol", date: "2026-05-01" },
        "gpt-6.2-sol": { family: "gpt-sol", date: "2026-11-14" },
      },
    });
    const entries = [
      { provider: "openai-codex", id: "gpt-6-sol" },
      { provider: "openai-codex", id: "gpt-6.2-sol" },
      { provider: "mycellios", id: "gpt-6-sol" },
    ];
    expect(
      applyModelListing(entries, catalog, { skipProviders: ["mycellios"], now: NOW }).map(
        (entry) => `${entry.provider}:${entry.id}:${entry.listing ?? "main"}`,
      ),
    ).toEqual([
      "openai-codex:gpt-6-sol:older",
      "openai-codex:gpt-6.2-sol:new",
      "mycellios:gpt-6-sol:main",
    ]);
  });
});

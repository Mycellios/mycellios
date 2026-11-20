import type { ModelCatalogEntry } from "@rakazo/contracts";
import { expect, it } from "vitest";
import { isFreeMycelliosModel, pickFreeMycelliosModel } from "./free-models";

const entry = (pricing?: { input: string; output: string; request?: string }): ModelCatalogEntry => ({
  provider: "openai-compatible",
  id: "fixture",
  label: "Fixture",
  billing: "",
  ...(pricing
    ? { mycelliosPricing: { currency: "credits" as const, unit: "token" as const, serviceFeeBasisPoints: 0 as const, ...pricing } }
    : {}),
});

it("accepts only a known zero price for input, output and requests", () => {
  expect(isFreeMycelliosModel(entry({ input: "0", output: "0.000" }))).toBe(true);
  expect(isFreeMycelliosModel(entry({ input: "0", output: "0", request: "0" }))).toBe(true);
  expect(isFreeMycelliosModel(entry({ input: "0", output: "0.000000000000000001" }))).toBe(false);
  expect(isFreeMycelliosModel(entry({ input: "0", output: "0", request: "0.01" }))).toBe(false);
  expect(isFreeMycelliosModel(entry())).toBe(false);
});

it("starts on the recommended free model and never on a priced recommendation", () => {
  const free = (id: string, recommended?: boolean): ModelCatalogEntry => ({
    ...entry({ input: "0", output: "0" }), id, ...(recommended ? { recommended: true } : {}),
  });
  const priced = { ...entry({ input: "0.1", output: "0.2" }), id: "priced", recommended: true };
  expect(pickFreeMycelliosModel([priced, free("a"), free("b", true)])?.id).toBe("b");
  expect(pickFreeMycelliosModel([priced, free("a"), free("b")])?.id).toBe("a");
  expect(pickFreeMycelliosModel([priced])).toBeUndefined();
});

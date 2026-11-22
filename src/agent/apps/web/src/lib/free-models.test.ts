import type { ModelCatalogEntry } from "@mycellios/contracts";
import { expect, it } from "vitest";
import { isFreeMycelliosModel, pickFreeMycelliosModel } from "./free-models";

const entry = (
  pricing?: { input: string; output: string; request?: string },
  overrides: Partial<ModelCatalogEntry> = {},
): ModelCatalogEntry => ({
  provider: "openai-compatible",
  id: "mycellios/managed/fixture",
  label: "Fixture",
  billing: "",
  mycelliosProcessing: "external",
  ...(pricing
    ? { mycelliosPricing: { currency: "credits" as const, unit: "token" as const, serviceFeeBasisPoints: 400 as const, ...pricing } }
    : {}),
  ...overrides,
});

it("accepts only a known zero price for input, output and requests", () => {
  expect(isFreeMycelliosModel(entry({ input: "0", output: "0.000" }))).toBe(true);
  expect(isFreeMycelliosModel(entry({ input: "0", output: "0", request: "0" }))).toBe(true);
  expect(isFreeMycelliosModel(entry({ input: "0", output: "0.000000000000000001" }))).toBe(false);
  expect(isFreeMycelliosModel(entry({ input: "0", output: "0", request: "0.01" }))).toBe(false);
  expect(isFreeMycelliosModel(entry())).toBe(false);
});

it("offers only managed AntSeed routes as free, never a zero-priced network model", () => {
  const zero = { input: "0", output: "0" };
  expect(isFreeMycelliosModel(entry(zero, { id: "qwen3-1.7b", mycelliosProcessing: "network" }))).toBe(false);
  const { mycelliosProcessing: _processing, ...unlabelled } = entry(zero, { id: "mycellios/managed/unlabelled" });
  expect(isFreeMycelliosModel(unlabelled)).toBe(false);
  expect(isFreeMycelliosModel(entry(zero, { id: "vendor/free" }))).toBe(false);
  expect(isFreeMycelliosModel(entry(zero, { id: "mycellios/managed/free" }))).toBe(true);
});

it("starts on the recommended free model and never on a priced recommendation", () => {
  const free = (id: string, recommended?: boolean): ModelCatalogEntry => ({
    ...entry({ input: "0", output: "0" }), id: `mycellios/managed/${id}`, ...(recommended ? { recommended: true } : {}),
  });
  const priced = { ...entry({ input: "0.1", output: "0.2" }), id: "mycellios/managed/priced", recommended: true };
  const network = { ...entry({ input: "0", output: "0" }, { id: "network", mycelliosProcessing: "network" }), recommended: true };
  expect(pickFreeMycelliosModel([priced, network, free("a"), free("b", true)])?.id).toBe("mycellios/managed/b");
  expect(pickFreeMycelliosModel([priced, network, free("a"), free("b")])?.id).toBe("mycellios/managed/a");
  expect(pickFreeMycelliosModel([priced, network])).toBeUndefined();
});

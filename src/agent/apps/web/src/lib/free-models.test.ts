import type { ModelCatalogEntry } from "@rakazo/contracts";
import { expect, it } from "vitest";
import { isFreeMycelliosModel } from "./free-models";

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

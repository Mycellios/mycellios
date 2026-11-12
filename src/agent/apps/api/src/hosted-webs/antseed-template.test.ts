import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { buildSync } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  ANTSEED_RADAR_HTML,
  estimateAntseedCost,
  parseAntseedSnapshot,
} from "./antseed-template.js";

const snapshot = (providers: unknown[]) => ({
  updatedAt: "2026-11-11T18:00:00.000Z",
  peers: [{ peerId: "peer-one", displayName: "Provider one", providers }],
});
describe("Antseed Radar snapshot interpretation", () => {
  it("runs the production esbuild-emitted page without external compiler helpers", () => {
    const output = buildSync({
      entryPoints: [fileURLToPath(new URL("./antseed-template.ts", import.meta.url))],
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22",
      write: false,
    });
    const context = { module: { exports: {} as { ANTSEED_RADAR_HTML: string } } };
    new Script(output.outputFiles[0]!.text).runInNewContext(context);
    const script = context.module.exports.ANTSEED_RADAR_HTML.match(
      /<script>([\s\S]+)<\/script>/,
    )![1]!;
    const parsed = new Script(
      `${script.split("const byId")[0]}\nparseSnapshot({peers:[]});`,
    ).runInNewContext();
    expect(parsed.offers).toHaveLength(0);
  });
  it("uses exact service overrides, falls back by field and keeps unknown rates distinct from zero", () => {
    const result = parseAntseedSnapshot(
      snapshot([
        {
          provider: "openai",
          services: ["m", "unknown", "free"],
          defaultPricing: { inputUsdPerMillion: 2 },
          servicePricing: {
            m: { outputUsdPerMillion: 4 },
            free: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
          },
        },
      ]),
    );
    expect(result.offers[0]).toMatchObject({ input: 2, output: 4, free: false });
    expect(result.offers[1]).toMatchObject({ input: 2, output: null, free: false });
    expect(result.offers[2]).toMatchObject({ input: 0, output: 0, free: true });
    expect(result).toMatchObject({
      peerCount: 1,
      modelCount: 3,
      updatedAt: "2026-11-11T18:00:00.000Z",
    });
  });
  it("does not mistake zero token rates on a paid image service for a free offer", () => {
    const result = parseAntseedSnapshot(
      snapshot([
        {
          provider: "images",
          services: ["image-model"],
          defaultPricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
          serviceUnitBillingModels: {
            "image-model": {
              "openai-images": { components: [{ unit: "output_images", priceUsd: 0.13 }] },
            },
          },
        },
      ]),
    );
    expect(result.offers[0]).toMatchObject({
      billing: "units",
      input: null,
      output: null,
      free: false,
      units: [{ unit: "output_images", price: 0.13 }],
    });
    expect(estimateAntseedCost(result.offers[0]!, 1000, 500)).toBeNull();
  });
  it("does not estimate an unknown unit model as token billing or free", () => {
    const result = parseAntseedSnapshot(
      snapshot([
        {
          services: ["video"],
          defaultPricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
          serviceUnitBillingModels: { video: { unknown: {} } },
        },
      ]),
    );
    expect(result.offers[0]).toMatchObject({ billing: "units", free: false, units: [] });
  });
  it("keeps incomplete or empty unit billing out of the free-token comparison", () => {
    const result = parseAntseedSnapshot(
      snapshot([
        {
          services: ["incomplete", "empty"],
          defaultPricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
          serviceUnitBillingModels: {
            incomplete: {
              images: {
                components: [
                  { unit: "images", priceUsd: 0 },
                  { unit: "extra", priceUsd: "unknown" },
                ],
              },
            },
            empty: {},
          },
        },
      ]),
    );
    expect(result.offers.every((offer) => offer.billing === "units" && !offer.free)).toBe(true);
    expect(parseAntseedSnapshot({ ...snapshot([]), updatedAt: 1e100 }).updatedAt).toBeNull();
  });
  it("rejects invalid and negative rates without showing them as zero", () => {
    const result = parseAntseedSnapshot(
      snapshot([
        { services: ["m"], defaultPricing: { inputUsdPerMillion: -1, outputUsdPerMillion: "0" } },
      ]),
    );
    expect(result.offers[0]).toMatchObject({ input: null, output: null, free: false });
    expect(() => parseAntseedSnapshot({ peers: "invalid" })).toThrow();
  });
  it("deduplicates a repeated peer/provider/service announcement without merging different providers", () => {
    const result = parseAntseedSnapshot(
      snapshot([
        { provider: "a", services: ["m", "m"] },
        { provider: "b", services: ["m"] },
      ]),
    );
    expect(result.offers).toHaveLength(2);
    expect(result.modelCount).toBe(1);
    expect(result.peerCount).toBe(1);
  });
  it("does not read prototype price entries for user-controlled service names", () => {
    const result = parseAntseedSnapshot(
      snapshot([
        { services: ["constructor", "__proto__"], servicePricing: {}, defaultPricing: {} },
      ]),
    );
    expect(
      result.offers.every((offer) => offer.input === null && offer.output === null && !offer.free),
    ).toBe(true);
  });
  it("computes comparable token cost and refuses invalid, unpriced or excessive inputs", () => {
    const offer = { billing: "tokens" as const, input: 2, output: 4 };
    expect(estimateAntseedCost(offer, 1000, 500)).toBe(0.004);
    expect(estimateAntseedCost(offer, NaN, 500)).toBeNull();
    expect(estimateAntseedCost(offer, -1, 500)).toBeNull();
    expect(estimateAntseedCost(offer, 1e10, 500)).toBeNull();
    expect(estimateAntseedCost({ ...offer, output: null }, 1000, 500)).toBeNull();
  });
  it("ships a self-contained public-data page with the exact tested parser and no privileged model calls", () => {
    expect(ANTSEED_RADAR_HTML).toContain(parseAntseedSnapshot.toString());
    expect(ANTSEED_RADAR_HTML).toContain(estimateAntseedCost.toString());
    expect(ANTSEED_RADAR_HTML).toContain('credentials:"omit"');
    expect(ANTSEED_RADAR_HTML).toContain("https://network.antseed.com/stats");
    expect(ANTSEED_RADAR_HTML).toContain("Herramienta comunitaria independiente");
    expect(ANTSEED_RADAR_HTML).not.toMatch(
      /localStorage|document\.cookie|\/chat\/completions|eval\(|Daniel|api[_-]?key/i,
    );
    const script = ANTSEED_RADAR_HTML.match(/<script>([\s\S]+)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Script(script!)).not.toThrow();
    const standaloneParser = new Script(`(${parseAntseedSnapshot.toString()})`).runInNewContext();
    expect(
      standaloneParser(
        snapshot([
          { services: ["m"], defaultPricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 2 } },
        ]),
      ).offers,
    ).toHaveLength(1);
  });
});

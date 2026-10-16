import { describe, expect, it } from "vitest";
import { deriveDecodeScales } from "../src/distribution/node-scale.js";

/**
 * Aislamiento por observación en `deriveDecodeScales`.
 *
 * El defecto: el cálculo indexaba por `nodeId` en un `Map`, así que dos
 * observaciones del MISMO nodo se colapsaban en una. Consecuencias:
 *  - una segunda observación `null` del mismo nodeId HEREDABA la medida de la
 *    primera y se declaraba `measured: true` sin haberse medido nunca;
 *  - dos medidas positivas distintas del mismo nodeId recaían ambas en la
 *    última del Map, y la primera perdía su propia escala.
 *
 * La regla correcta: cada salida usa SU observación, conserva el orden de
 * entrada, comparte la referencia global (el máximo medido) y respeta los
 * clamps. Estas pruebas fijan ese contrato.
 */
describe("deriveDecodeScales aísla observaciones duplicadas por nodeId", () => {
  it("una segunda observación null no hereda la medida de su gemela", () => {
    const result = deriveDecodeScales([
      { nodeId: "n1", measuredTokensPerSecond: 100 },
      { nodeId: "n1", measuredTokensPerSecond: null },
    ]);

    expect(result.scales).toHaveLength(2);
    // La medible conserva su medida y la referencia global.
    expect(result.scales[0]).toEqual({ nodeId: "n1", decodeScale: 1, measured: true });
    // La no medible conserva measured=false y decodeScale=1, sin heredar nada.
    expect(result.scales[1]).toEqual({ nodeId: "n1", decodeScale: 1, measured: false });
    expect(result.referenceTokensPerSecond).toBe(100);
    expect(result.fullyMeasured).toBe(false);
  });

  it("conserva el orden cuando la observación null va primero", () => {
    const result = deriveDecodeScales([
      { nodeId: "n1", measuredTokensPerSecond: null },
      { nodeId: "n1", measuredTokensPerSecond: 100 },
    ]);

    expect(result.scales[0]).toEqual({ nodeId: "n1", decodeScale: 1, measured: false });
    expect(result.scales[1]).toEqual({ nodeId: "n1", decodeScale: 1, measured: true });
    expect(result.referenceTokensPerSecond).toBe(100);
  });

  it("un cero duplicado no se mide ni hereda la medida de su gemela", () => {
    const result = deriveDecodeScales([
      { nodeId: "n1", measuredTokensPerSecond: 100 },
      { nodeId: "n1", measuredTokensPerSecond: 0 },
    ]);

    expect(result.scales[0]).toEqual({ nodeId: "n1", decodeScale: 1, measured: true });
    expect(result.scales[1]).toEqual({ nodeId: "n1", decodeScale: 1, measured: false });
    expect(result.referenceTokensPerSecond).toBe(100);
    expect(result.fullyMeasured).toBe(false);
  });

  it("un NaN duplicado no se mide ni hereda la medida de su gemela", () => {
    const result = deriveDecodeScales([
      { nodeId: "n1", measuredTokensPerSecond: 100 },
      { nodeId: "n1", measuredTokensPerSecond: Number.NaN },
    ]);

    expect(result.scales[0]).toEqual({ nodeId: "n1", decodeScale: 1, measured: true });
    expect(result.scales[1]).toEqual({ nodeId: "n1", decodeScale: 1, measured: false });
    expect(result.referenceTokensPerSecond).toBe(100);
    expect(result.fullyMeasured).toBe(false);
  });

  it("dos medidas positivas distintas usan cada una SU propia observación", () => {
    const result = deriveDecodeScales([
      { nodeId: "n1", measuredTokensPerSecond: 100 },
      { nodeId: "n1", measuredTokensPerSecond: 50 },
    ]);

    // Referencia global = 100. Cada salida se normaliza contra SU medición:
    // 100 -> 1, 50 -> 2 (no ambas 2 como antes).
    expect(result.scales[0]).toEqual({ nodeId: "n1", decodeScale: 1, measured: true });
    expect(result.scales[1]).toEqual({ nodeId: "n1", decodeScale: 2, measured: true });
    expect(result.referenceTokensPerSecond).toBe(100);
    expect(result.fullyMeasured).toBe(true);
  });

  it("la referencia global se comparte entre nodos distintos y duplicados", () => {
    const result = deriveDecodeScales([
      { nodeId: "a", measuredTokensPerSecond: 40 },
      { nodeId: "b", measuredTokensPerSecond: 40 },
      { nodeId: "a", measuredTokensPerSecond: null },
      { nodeId: "b", measuredTokensPerSecond: 10 },
    ]);

    expect(result.referenceTokensPerSecond).toBe(40);
    expect(result.scales).toEqual([
      { nodeId: "a", decodeScale: 1, measured: true },
      { nodeId: "b", decodeScale: 1, measured: true },
      { nodeId: "a", decodeScale: 1, measured: false },
      { nodeId: "b", decodeScale: 4, measured: true },
    ]);
    expect(result.fullyMeasured).toBe(false);
  });

  it("aplica clamps a cada observación medida duplicada", () => {
    const result = deriveDecodeScales([
      { nodeId: "n1", measuredTokensPerSecond: 1000 },
      { nodeId: "n1", measuredTokensPerSecond: 0.001 },
    ]);

    expect(result.scales[0]!.decodeScale).toBe(1);
    expect(result.scales[1]!.decodeScale).toBeLessThanOrEqual(20);
    expect(result.scales[1]!.decodeScale).toBeGreaterThanOrEqual(0.1);
    expect(result.scales[1]!.measured).toBe(true);
  });
});

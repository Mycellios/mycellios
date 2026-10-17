import { describe, expect, it } from "vitest";
import { deriveDecodeScales } from "../src/distribution/node-scale.js";

/**
 * Normalización de referencias con una flota grande.
 *
 * Defecto: la referencia global se calculaba con `Math.max(...measured)`, es
 * decir pasando TODAS las medidas como argumentos. V8 limita el número de
 * argumentos (~125.000) y lanza `RangeError: Maximum call stack size exceeded`,
 * así que la normalización no fallaba por un dato sino por el tamaño de la
 * flota. El arreglo recorre la lista sin volcar argumentos.
 *
 * Contrato que estas pruebas fijan: se conserva el orden, la referencia global
 * es el máximo medido, cada observación usa SU medida y los clamps siguen
 * aplicándose igual que antes del arreglo.
 */
describe("deriveDecodeScales normaliza referencias de una flota grande", () => {
  it("no agota la pila y conserva la referencia global y el orden", () => {
    const nodeCount = 200_000;
    const observations = Array.from({ length: nodeCount }, (_, index) => ({
      nodeId: `n${index}`,
      measuredTokensPerSecond: index === 0 ? 200 : 50,
    }));

    const result = deriveDecodeScales(observations);

    expect(result.referenceTokensPerSecond).toBe(200);
    expect(result.fullyMeasured).toBe(true);
    expect(result.scales).toHaveLength(nodeCount);
    // La observación más rápida es la referencia y queda en 1.
    expect(result.scales[0]).toEqual({ nodeId: "n0", decodeScale: 1, measured: true });
    // El resto es cuatro veces más lento y conserva su multiplicador de coste.
    expect(result.scales[nodeCount - 1]).toEqual({
      nodeId: `n${nodeCount - 1}`,
      decodeScale: 4,
      measured: true,
    });
  });

  it("sigue aplicando los clamps dentro de una flota grande", () => {
    const nodeCount = 200_000;
    const observations = [
      ...Array.from({ length: nodeCount }, (_, index) => ({
        nodeId: `n${index}`,
        measuredTokensPerSecond: 200,
      })),
      { nodeId: "penoso", measuredTokensPerSecond: 0.001 },
    ];

    const result = deriveDecodeScales(observations);
    const penoso = result.scales[result.scales.length - 1]!;

    expect(result.referenceTokensPerSecond).toBe(200);
    expect(penoso.measured).toBe(true);
    expect(penoso.decodeScale).toBe(20);
  });
});

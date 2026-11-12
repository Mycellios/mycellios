import { createHash } from "node:crypto";

/** Independent bounded reference; public canaries/replica agreement cannot authorize payment. */
export function expertReference(weights: Buffer, hash: string, input: Float32Array,
  rows: number, hidden: number, intermediate: number): Float32Array {
  const operations = rows * hidden * intermediate * 3;
  if (![rows, hidden, intermediate].every(v => Number.isSafeInteger(v) && v > 0)
    || operations > 20_000_000 || input.length !== rows * hidden
    || weights.length > 64 * 1024 * 1024 || weights.length !== hidden * intermediate * 3 * 4
    || createHash("sha256").update(weights).digest("hex") !== hash)
    throw new Error("browser_reference_bounds_or_revision_invalid");
  const values = new Float32Array(weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.length));
  if (!values.every(Number.isFinite) || !input.every(Number.isFinite)) throw new Error("browser_reference_nonfinite");
  const width = hidden * intermediate;
  const output = new Float32Array(rows * hidden);
  for (let r = 0; r < rows; r++) {
    const activated = new Float32Array(intermediate);
    for (let j = 0; j < intermediate; j++) {
      let gate = 0, up = 0;
      for (let h = 0; h < hidden; h++) {
        gate += input[r * hidden + h]! * values[j * hidden + h]!;
        up += input[r * hidden + h]! * values[width + j * hidden + h]!;
      }
      activated[j] = (gate / (1 + Math.exp(-gate))) * up;
    }
    for (let h = 0; h < hidden; h++) {
      let sum = 0;
      for (let j = 0; j < intermediate; j++) sum += activated[j]! * values[2 * width + h * intermediate + j]!;
      output[r * hidden + h] = sum;
    }
  }
  if (!output.every(Number.isFinite)) throw new Error("browser_reference_nonfinite");
  return output;
}

/** Internal credits use USD parity; Spore is a separate token, never this unit. */
export const CREDIT_MICROUNITS = 1_000_000;
export const CREDIT_USD_PARITY = 1;

/** Convert settled USD cents exactly, without floating-point money arithmetic. */
export function usdCentsToCreditMicrounits(cents: number): bigint {
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new Error("Invalid credit purchase");
  return BigInt(cents) * BigInt(CREDIT_MICROUNITS / 100);
}

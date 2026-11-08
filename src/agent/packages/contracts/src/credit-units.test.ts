import { describe, expect, it } from "vitest";
import { CREDIT_MICROUNITS, CREDIT_USD_PARITY, usdCentsToCreditMicrounits } from "./credit-units.js";

describe("internal credit denomination", () => {
  it("gives ten credits for ten USD and preserves sub-cent balances", () => {
    expect(CREDIT_USD_PARITY).toBe(1);
    expect(usdCentsToCreditMicrounits(1_000)).toBe(10_000_000n);
    expect(Number(usdCentsToCreditMicrounits(1_000)) / CREDIT_MICROUNITS).toBe(10);
    expect(usdCentsToCreditMicrounits(1)).toBe(10_000n);
    expect(usdCentsToCreditMicrounits(0)).toBe(0n);
    expect(usdCentsToCreditMicrounits(Number.MAX_SAFE_INTEGER)).toBe(BigInt(Number.MAX_SAFE_INTEGER) * 10_000n);
  });
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid payment cents %s", cents => {
    expect(() => usdCentsToCreditMicrounits(cents)).toThrow("Invalid credit purchase");
  });
});

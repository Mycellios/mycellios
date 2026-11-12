import type { ManagedCharge } from "../contracts/managed-provider.js";

const SCALE = 10n ** 18n;
/** Provider money is parsed as decimal text, never multiplied using binary floating point. */
export function usdAtoms(value: string): bigint {
  const scientific = /^(0|[1-9]\d*)(?:\.(\d+))?[eE]([+-]?\d{1,2})$/.exec(value);
  if (scientific) {
    const digits = scientific[1]! + (scientific[2] ?? "");
    const point = scientific[1]!.length + Number(scientific[3]);
    value = point <= 0 ? "0." + "0".repeat(-point) + digits
      : point >= digits.length ? digits + "0".repeat(point - digits.length)
        : digits.slice(0, point) + "." + digits.slice(point);
  }
  if (!/^(0|[1-9]\d{0,8})(\.\d{1,18})?$/.test(value)) throw new Error("managed_price_invalid");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * SCALE + BigInt(fraction.padEnd(18, "0"));
}
function decimal(atoms: bigint): string {
  return `${atoms / SCALE}.${(atoms % SCALE).toString().padStart(18, "0")}`.replace(/\.?0+$/, "");
}
function safe(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("managed_price_overflow");
  return Number(value);
}
export function markedUpUnitPrice(usd: string, fundingCostBasisPoints = 0): string {
  // Preserve precision rather than rounding a tiny per-token price up to a microcredit.
  const atoms = usdAtoms(usd);
  const factor = fundingFactor(fundingCostBasisPoints) * 104n;
  return decimal((atoms * factor + 999999n) / 1000000n);
}
function fundingFactor(bps: number): bigint {
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 100000) throw new Error("managed_funding_cost_invalid");
  return 10000n + BigInt(bps);
}
export function managedCharge(usd: string, fundingCostBasisPoints = 0): ManagedCharge {
  const atoms = usdAtoms(usd);
  const factor = fundingFactor(fundingCostBasisPoints);
  // Positive supplier costs must never disappear at wallet precision. Exact zero stays zero.
  const ceil = (value: bigint, divisor: bigint) => (value + divisor - 1n) / divisor;
  const upstream = safe(ceil(atoms * 1_000_000n, SCALE));
  const loaded = safe(ceil(atoms * factor * 1_000_000n, SCALE * 10000n));
  const total = safe(ceil(atoms * factor * 104n * 1_000_000n, SCALE * 1000000n));
  return { upstreamUsd: decimal(atoms), upstreamMicrounits: upstream,
    ...(fundingCostBasisPoints ? { fundingCostMicrounits: loaded - upstream, fundingCostBasisPoints } : {}),
    serviceFeeMicrounits: total - loaded, totalMicrounits: total, serviceFeeBasisPoints: 400 };
}
export function addUsd(...values: string[]): string { return decimal(values.reduce((sum, value) => sum + usdAtoms(value), 0n)); }
/** Conservative exact multiplication for quoted unit bounds, including fractional seconds/megapixels. */
export function unitCost(usd:string,numerator:number,denominator=1):string {
  if(![numerator,denominator].every(Number.isSafeInteger)||numerator<0||denominator<1)throw new Error("managed_usage_invalid");
  return decimal((usdAtoms(usd)*BigInt(numerator)+BigInt(denominator)-1n)/BigInt(denominator));
}
/** Derive a conservative effective fee from an operator's real funding receipt, including minimum fees. */
export function effectiveFundingCostBasisPoints(paidUsd:string,creditedUsd:string):number {
  const paid=usdAtoms(paidUsd),credited=usdAtoms(creditedUsd);
  if(credited===0n||paid<credited)throw new Error("managed_funding_receipt_invalid");
  const bps=safe(((paid-credited)*10000n+credited-1n)/credited);
  fundingFactor(bps);return bps;
}
export function tokenCost(inputUsd: string, outputUsd: string, input: number, output: number): string {
  if (![input, output].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error("managed_usage_invalid");
  return decimal(usdAtoms(inputUsd) * BigInt(input) + usdAtoms(outputUsd) * BigInt(output));
}

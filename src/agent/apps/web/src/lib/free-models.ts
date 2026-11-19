import type { ModelCatalogEntry } from "@rakazo/contracts";

const zero = (value: string | undefined) => !value || /^0(\.0+)?$/.test(value);

/**
 * A Mycellios catalog model whose admitted price is zero for input, output and any per-request fee.
 * A model without a known price is never free: unknown cost stays unavailable.
 */
export function isFreeMycelliosModel(entry: ModelCatalogEntry): boolean {
  const price = entry.mycelliosPricing;
  return Boolean(price && zero(price.input) && zero(price.output) && zero(price.request));
}

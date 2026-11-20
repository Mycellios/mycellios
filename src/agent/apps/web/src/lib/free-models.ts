import type { ModelCatalogEntry } from "@rakazo/contracts";

const zero = (value: string | undefined) => !value || /^0(\.0+)?$/.test(value);
/** Managed Mycellios routes; the coordinator serves their zero-priced offers only from AntSeed. */
const MANAGED_MODEL_PREFIX = "mycellios/managed/";

/**
 * A free model this product offers: a managed Mycellios route (served through AntSeed) whose
 * admitted price is zero for input, output and any per-request fee. Network-hosted or unpriced
 * models are never offered as free: unknown cost stays unavailable.
 */
export function isFreeMycelliosModel(entry: ModelCatalogEntry): boolean {
  const price = entry.mycelliosPricing;
  return Boolean(
    entry.mycelliosProcessing === "external" &&
      entry.id.startsWith(MANAGED_MODEL_PREFIX) &&
      price &&
      zero(price.input) &&
      zero(price.output) &&
      zero(price.request),
  );
}

/**
 * The free model a new account starts on: the one Mycellios recommends from live AntSeed
 * signals, otherwise the first free one in catalog order. Never a priced model.
 */
export function pickFreeMycelliosModel(entries: readonly ModelCatalogEntry[]): ModelCatalogEntry | undefined {
  const free = entries.filter(isFreeMycelliosModel);
  return free.find((entry) => entry.recommended) ?? free[0];
}

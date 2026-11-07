import { i18n } from "@lingui/core";
import type { Me, ModelCatalogEntry, ModelCredential, ThinkingLevel } from "@rakazo/contracts";
import type { ConnectedModelChoice } from "@rakazo/core";
import { connectedModelChoices, resolveSelectableModelId } from "@rakazo/core";

export { modelOptionKey, parseModelOptionKey } from "@rakazo/core";

/** The models the connected credentials can run, as one list for a picker. */
export function connectedModelOptions(
  credentials: ModelCredential[],
  catalog: ModelCatalogEntry[],
): ConnectedModelChoice[] {
  return connectedModelChoices(credentials, catalog);
}

export function selectableCatalogEntry(
  catalog: ModelCatalogEntry[],
  provider: string,
  modelId: string,
) {
  const id = resolveSelectableModelId(catalog, provider, modelId);
  return catalog.find((entry) => entry.provider === provider && entry.id === id)
    ?? catalog.find((entry) =>
      entry.provider === provider && resolveSelectableModelId(catalog, provider, entry.id) === id,
    );
}

export function generalChatModel(me: Me | null | undefined, catalog: ModelCatalogEntry[]) {
  if (!me || me.needsModel || !me.defaultProvider || !me.defaultModel) return null;
  const { defaultProvider: provider, defaultModel: modelId } = me;
  const entry = selectableCatalogEntry(catalog, provider, modelId);
  return { provider, modelId, entry, label: entry?.label ?? modelId };
}

export function thinkingLevelLabel(level: ThinkingLevel) {
  if (level === "xhigh") return i18n._({ id: "Extra high", message: "Extra high" });
  if (level === "low") return i18n._({ id: "Low", message: "Low" });
  if (level === "medium") return i18n._({ id: "Medium", message: "Medium" });
  if (level === "high") return i18n._({ id: "High", message: "High" });
  if (level === "minimal") return i18n._({ id: "Minimal", message: "Minimal" });
  if (level === "max") return i18n._({ id: "Max", message: "Max" });
  return `${level.slice(0, 1).toUpperCase()}${level.slice(1)}`;
}

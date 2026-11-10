export type NativeCodexModel = {
  id: string; label: string; isDefault: boolean; thinkingLevels: string[]; defaultThinkingLevel?: string; fast: boolean;
};
export function nativeCodexModels(value: unknown): NativeCodexModel[] {
  const data = (value as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new Error("Codex model catalog unavailable.");
  return data.slice(0, 128).flatMap(entry => {
    if (!entry || typeof entry.id !== "string" || entry.hidden) return [];
    return [{ id: entry.model || entry.id, label: entry.displayName || entry.id, isDefault: entry.isDefault === true,
      thinkingLevels: (entry.supportedReasoningEfforts ?? []).map((level: { reasoningEffort: string }) => level.reasoningEffort),
      defaultThinkingLevel: entry.defaultReasoningEffort,
      fast: (entry.serviceTiers ?? []).some((tier: { id: string }) => tier.id === "priority" || tier.id === "fast"),
    }];
  });
}
export function codexTurnSettings(settings: { modelId?: string | null; thinkingLevel?: string | null; fastMode?: boolean }, models: NativeCodexModel[]) {
  const model = settings.modelId ? models.find(model => model.id === settings.modelId) : models.find(model => model.isDefault);
  if (!model) throw new Error("The selected Codex model is unavailable for this account.");
  if (settings.fastMode && !model.fast) throw new Error("Fast mode is unavailable for the selected Codex model.");
  if (settings.thinkingLevel && !model.thinkingLevels.includes(settings.thinkingLevel)) throw new Error("The selected reasoning effort is unavailable for this Codex model.");
  return { ...(settings.modelId ? { model: settings.modelId } : {}),
    ...(settings.thinkingLevel ? { effort: settings.thinkingLevel } : {}), serviceTier: settings.fastMode ? "priority" : "default" };
}

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

/** Claude Code's `initialize` control response lists the models its signed-in account can use. */
export function nativeClaudeModels(value: unknown): NativeCodexModel[] {
  const models = (value as { models?: unknown })?.models;
  if (!Array.isArray(models)) throw new Error("Claude Code model catalog unavailable.");
  return models.slice(0, 128).flatMap((entry: Record<string, unknown> | null) => {
    if (!entry || typeof entry !== "object" || typeof entry.value !== "string" || !entry.value || entry.value.length > 200) return [];
    const levels = entry.supportsEffort === true && Array.isArray(entry.supportedEffortLevels)
      ? entry.supportedEffortLevels.filter((level): level is string => typeof level === "string") : [];
    return [{ id: entry.value, label: typeof entry.displayName === "string" && entry.displayName ? entry.displayName : entry.value,
      isDefault: entry.value === "default", thinkingLevels: levels, fast: false }];
  });
}

/** CLI arguments for the saved Claude Code choice, checked against that CLI's own catalog. */
export function claudeTurnArgs(
  settings: { modelId?: string | null; thinkingLevel?: string | null; fastMode?: boolean },
  models: NativeCodexModel[] | undefined,
) {
  if (settings.fastMode) throw new Error("Fast mode is unavailable for Claude Code.");
  if (!settings.modelId && !settings.thinkingLevel) return [];
  // An unreadable catalog leaves the check to the CLI, which refuses an unknown model itself.
  const model = models && (settings.modelId
    ? models.find(entry => entry.id === settings.modelId)
    : models.find(entry => entry.isDefault));
  if (models && settings.modelId && !model) throw new Error("The selected Claude Code model is unavailable for this account.");
  if (model && settings.thinkingLevel && !model.thinkingLevels.includes(settings.thinkingLevel))
    throw new Error("The selected effort is unavailable for this Claude Code model.");
  return [
    ...(settings.modelId && settings.modelId !== "default" ? ["--model", settings.modelId] : []),
    ...(settings.thinkingLevel ? ["--effort", settings.thinkingLevel] : []),
  ];
}

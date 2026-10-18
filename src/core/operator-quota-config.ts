/** Explicit operator-funded quota: API key IDs are public identifiers, never secrets. */
export function parseOperatorQuotaModels(value: string | undefined): Readonly<Record<string, readonly string[]>> {
  if (!value?.trim()) return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Operator quota must be a key-to-models object");
  const entries = Object.entries(parsed);
  if (entries.length > 64) throw new Error("Too many operator quota keys");
  for (const [key, models] of entries) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(key) || !Array.isArray(models) || models.length < 1 || models.length > 16
      || models.some((model: unknown) => typeof model !== "string" || !model.trim() || model.length > 200)) {
      throw new Error("Invalid operator quota key or model list");
    }
  }
  return Object.fromEntries(entries.map(([key, models]) => [key, Object.freeze([...models])]));
}

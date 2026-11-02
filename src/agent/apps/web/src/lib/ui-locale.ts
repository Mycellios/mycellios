export const UI_LOCALES = [
  "en",
  "de",
  "ko",
  "tr",
  "hi",
  "pt-BR",
  "zh-CN",
  "es",
  "ru",
  "fr",
  "he",
  "nl",
  "ja",
] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

export const UI_LOCALE_STORAGE_KEY = "rakazo.uiLocale";

export const UI_LOCALE_LABELS: Record<UiLocale, string> = {
  en: "English",
  de: "Deutsch",
  ko: "한국어",
  tr: "Türkçe",
  hi: "हिन्दी",
  "pt-BR": "Português (Brasil)",
  "zh-CN": "简体中文",
  es: "Español",
  ru: "Русский",
  fr: "Français",
  he: "עברית",
  nl: "Nederlands",
  ja: "日本語",
};

/** Return whether a value is one of the supported web UI locales. */
export function isUiLocale(value: string | null | undefined): value is UiLocale {
  return (
    value === "en" ||
    value === "de" ||
    value === "ko" ||
    value === "tr" ||
    value === "hi" ||
    value === "pt-BR" ||
    value === "zh-CN" ||
    value === "es" ||
    value === "ru" ||
    value === "fr" ||
    value === "he" ||
    value === "nl" ||
    value === "ja"
  );
}

/** Normalize BCP-47 tags (`de-DE`, `ko-KR`, `pt-BR`, `zh-CN`, `es-ES`) to a supported UI locale, else `en`. */
export function normalizeUiLocale(raw: string | null | undefined): UiLocale {
  if (!raw) return "en";
  const normalized = raw.trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "pt" || normalized.startsWith("pt-")) return "pt-BR";
  if (normalized === "es" || normalized.startsWith("es-")) return "es";
  // `iw` is the legacy ISO 639 code for Hebrew that some browsers and Android still report.
  if (normalized === "iw" || normalized.startsWith("iw-")) return "he";
  // Simplified Chinese only. Do not fold zh-TW / zh-HK / zh-Hant into zh-CN.
  if (
    normalized === "zh" ||
    normalized === "zh-cn" ||
    normalized === "zh-hans" ||
    normalized === "zh-sg" ||
    normalized.startsWith("zh-hans-") ||
    normalized.startsWith("zh-cn-")
  ) {
    return "zh-CN";
  }
  const primary = normalized.split("-")[0] ?? "";
  return isUiLocale(primary) ? primary : "en";
}

function readStoredLocale(storage: Pick<Storage, "getItem"> | null | undefined): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(UI_LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export type ResolveUiLocaleOptions = {
  stored?: string | null;
  storage?: Pick<Storage, "getItem"> | null;
};

/** Use the customer's saved choice; first visits always start in English. */
export function resolveUiLocale(options: ResolveUiLocaleOptions = {}): UiLocale {
  const stored =
    options.stored !== undefined
      ? options.stored
      : readStoredLocale(
          options.storage ?? (typeof localStorage !== "undefined" ? localStorage : null),
        );
  return stored ? normalizeUiLocale(stored) : "en";
}

export function persistUiLocale(
  locale: UiLocale,
  storage: Pick<Storage, "setItem"> | null = typeof localStorage !== "undefined"
    ? localStorage
    : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(UI_LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore quota / private-mode failures; in-memory locale still applies.
  }
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { panelCatalogs, type PanelMessageKey } from "./messages";

export type PanelLocale = "es" | "en";
export type PanelMessageValues = Record<string, string | number>;
export type PanelTranslate = (key: PanelMessageKey, values?: PanelMessageValues) => string;

export const PANEL_LOCALES: readonly PanelLocale[] = ["es", "en"];
export const PANEL_LOCALE_STORAGE_KEY = "mycellios.panel-locale";

/** Replaces `{name}` placeholders; an unknown placeholder stays visible instead of vanishing. */
export function formatPanelMessage(template: string, values?: PanelMessageValues): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match);
}

export function panelTranslator(locale: PanelLocale): PanelTranslate {
  const catalog = panelCatalogs[locale];
  return (key, values) => formatPanelMessage(catalog[key], values);
}

/** Spanish for any `es*` browser language, English for everything else. */
export function detectPanelLocale(language: string | undefined = globalThis.navigator?.language): PanelLocale {
  return language?.toLowerCase().startsWith("es") ? "es" : "en";
}

function isPanelLocale(value: unknown): value is PanelLocale {
  return value === "es" || value === "en";
}

/** A saved explicit choice wins; storage can be blocked, so failures fall back to the browser. */
export function initialPanelLocale(): PanelLocale {
  try {
    const saved = globalThis.localStorage?.getItem(PANEL_LOCALE_STORAGE_KEY);
    if (isPanelLocale(saved)) return saved;
  } catch {
    // Private windows and blocked site data still get the browser language.
  }
  return detectPanelLocale();
}

export function savePanelLocale(locale: PanelLocale): void {
  try {
    globalThis.localStorage?.setItem(PANEL_LOCALE_STORAGE_KEY, locale);
  } catch {
    // The choice still applies for this visit.
  }
}

/** Sets `<html lang>` for the panel and returns the restore step for unmounting. */
export function applyDocumentLanguage(root: { lang: string } | undefined, locale: PanelLocale): (() => void) | undefined {
  if (!root) return undefined;
  const previous = root.lang;
  root.lang = locale;
  return () => { root.lang = previous; };
}

interface PanelI18n {
  locale: PanelLocale;
  setLocale: (locale: PanelLocale) => void;
  t: PanelTranslate;
}

// Components rendered outside the dashboard (the standalone downloads page,
// Storybook without the toggle, tests) keep their English text.
const englishI18n: PanelI18n = { locale: "en", setLocale: () => undefined, t: panelTranslator("en") };
const PanelI18nContext = createContext<PanelI18n>(englishI18n);

export function usePanelI18n(): PanelI18n {
  return useContext(PanelI18nContext);
}

/**
 * The dashboard's language. Only the panel mounts this provider, so `<html lang>`
 * follows the choice there while public pages keep their own markup.
 */
export function PanelI18nProvider({ locale: fixedLocale, persist = true, children }: {
  /** A fixed locale for previews; the switch then changes only this mount. */
  locale?: PanelLocale;
  persist?: boolean;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<PanelLocale>(() => fixedLocale ?? initialPanelLocale());
  useEffect(() => { if (fixedLocale) setLocaleState(fixedLocale); }, [fixedLocale]);
  const setLocale = useCallback((next: PanelLocale) => {
    setLocaleState(next);
    if (persist) savePanelLocale(next);
  }, [persist]);
  useEffect(() => applyDocumentLanguage(globalThis.document?.documentElement, locale), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t: panelTranslator(locale) }), [locale, setLocale]);
  return <PanelI18nContext.Provider value={value}>{children}</PanelI18nContext.Provider>;
}

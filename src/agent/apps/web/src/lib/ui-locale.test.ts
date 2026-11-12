import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeUiLocale,
  persistUiLocale,
  resolveUiLocale,
  readUiLocalePreference,
  resolveSystemUiLocale,
  UI_LOCALE_STORAGE_KEY,
} from "./ui-locale";

describe("normalizeUiLocale", () => {
  it("maps regional tags onto supported locales", () => {
    expect(normalizeUiLocale("de-DE")).toBe("de");
    expect(normalizeUiLocale("ko-KR")).toBe("ko");
    expect(normalizeUiLocale("en-US")).toBe("en");
    expect(normalizeUiLocale("pt-BR")).toBe("pt-BR");
    expect(normalizeUiLocale("pt")).toBe("pt-BR");
    expect(normalizeUiLocale("hi-IN")).toBe("hi");
    expect(normalizeUiLocale("DE")).toBe("de");
    expect(normalizeUiLocale("es")).toBe("es");
    expect(normalizeUiLocale("es-ES")).toBe("es");
    expect(normalizeUiLocale("es-MX")).toBe("es");
    expect(normalizeUiLocale("es-419")).toBe("es");
    expect(normalizeUiLocale("ES")).toBe("es");
    expect(normalizeUiLocale("es_AR")).toBe("es");
    expect(normalizeUiLocale("ru-RU")).toBe("ru");
    expect(normalizeUiLocale("ru_KZ")).toBe("ru");
    expect(normalizeUiLocale(" RU ")).toBe("ru");
    expect(normalizeUiLocale("fr")).toBe("fr");
    expect(normalizeUiLocale("fr-FR")).toBe("fr");
    expect(normalizeUiLocale("fr-CA")).toBe("fr");
    expect(normalizeUiLocale("FR")).toBe("fr");
    expect(normalizeUiLocale("fr_BE")).toBe("fr");
    expect(normalizeUiLocale("he")).toBe("he");
    expect(normalizeUiLocale("he-IL")).toBe("he");
    expect(normalizeUiLocale("HE")).toBe("he");
    expect(normalizeUiLocale("he_IL")).toBe("he");
    expect(normalizeUiLocale("nl")).toBe("nl");
    expect(normalizeUiLocale("nl-NL")).toBe("nl");
    expect(normalizeUiLocale("nl-BE")).toBe("nl");
    expect(normalizeUiLocale("NL")).toBe("nl");
    expect(normalizeUiLocale("nl_nl")).toBe("nl");
    expect(normalizeUiLocale("ja")).toBe("ja");
    expect(normalizeUiLocale("ja-JP")).toBe("ja");
    expect(normalizeUiLocale("ja_JP")).toBe("ja");
    expect(normalizeUiLocale("iw")).toBe("he");
    expect(normalizeUiLocale("iw-IL")).toBe("he");
    expect(normalizeUiLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeUiLocale("zh")).toBe("zh-CN");
    expect(normalizeUiLocale("zh-Hans")).toBe("zh-CN");
    expect(normalizeUiLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(normalizeUiLocale("zh-Hans-SG")).toBe("zh-CN");
    expect(normalizeUiLocale("zh-SG")).toBe("zh-CN");
    expect(normalizeUiLocale("zh_cn")).toBe("zh-CN");
    expect(normalizeUiLocale("ZH-cn")).toBe("zh-CN");
    expect(normalizeUiLocale(" zh-CN ")).toBe("zh-CN");
    expect(normalizeUiLocale("zh_Hans_CN")).toBe("zh-CN");
  });

  it("does not fold Traditional Chinese into Simplified", () => {
    expect(normalizeUiLocale("zh-TW")).toBe("en");
    expect(normalizeUiLocale("zh-HK")).toBe("en");
    expect(normalizeUiLocale("zh-MO")).toBe("en");
    expect(normalizeUiLocale("zh-Hant")).toBe("en");
    expect(normalizeUiLocale("zh-Hant-TW")).toBe("en");
    expect(normalizeUiLocale("zh-Hant-HK")).toBe("en");
  });

  it("falls back to English for unknown locales", () => {
    expect(normalizeUiLocale("sv-SE")).toBe("en");
    expect(normalizeUiLocale("")).toBe("en");
    expect(normalizeUiLocale(null)).toBe("en");
  });
});

describe("resolveUiLocale", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("detects the device language on first visit regardless of build defaults", () => {
    vi.stubEnv("VITE_DEFAULT_UI_LOCALE", "de");
    for (const language of ["es-ES", "fr-FR", "he-IL", "ja-JP"]) {
      vi.stubGlobal("navigator", { language, languages: [language] });
      expect(resolveUiLocale({ stored: null })).toBe(normalizeUiLocale(language));
    }
  });

  it("uses only supported saved choices", () => {
    expect(resolveUiLocale({ stored: "es" })).toBe("es");
    expect(resolveUiLocale({ stored: "ja" })).toBe("ja");
    expect(resolveUiLocale({ stored: "invalid" })).toBe("en");
  });

  it("remembers the customer's explicit choice on the next load", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    expect(resolveUiLocale({ storage, languages: ["en-US"] })).toBe("en");
    persistUiLocale("es", storage);
    expect(resolveUiLocale({ storage })).toBe("es");
  });

  it("detects the device language when reading preferences is blocked", () => {
    expect(resolveUiLocale({ storage: { getItem: () => { throw new Error("blocked"); } }, languages:["fr-FR"] })).toBe("fr");
  });

  it("keeps automatic mode distinct from the resolved language", () => {
    expect(readUiLocalePreference({stored:null})).toBe("system");
    expect(readUiLocalePreference({stored:"system"})).toBe("system");
    expect(resolveUiLocale({stored:"system",languages:["es-MX"]})).toBe("es");
    expect(resolveUiLocale({stored:"de",languages:["es-MX"]})).toBe("de");
  });

  it("uses the first supported device language without folding Traditional Chinese", () => {
    expect(resolveSystemUiLocale(["ca-ES","fr-CA","es-ES"])).toBe("fr");
    expect(resolveSystemUiLocale(["zh-Hant-TW","ja-JP"])).toBe("ja");
    expect(resolveSystemUiLocale(["en-GB","es-ES"])).toBe("en");
    expect(resolveSystemUiLocale([])).toBe("en");
    expect(resolveSystemUiLocale(["ca-ES"])).toBe("en");
  });
});

describe("persistUiLocale", () => {
  it("writes the storage key", () => {
    const store = new Map<string, string>();
    persistUiLocale("ko", {
      setItem: (key, value) => {
        store.set(key, value);
      },
    });
    expect(store.get(UI_LOCALE_STORAGE_KEY)).toBe("ko");
  });
});

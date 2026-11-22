import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { panelCatalogs, panelMessageAreas } from "./messages";
import {
  detectPanelLocale,
  formatPanelMessage,
  initialPanelLocale,
  PANEL_LOCALE_STORAGE_KEY,
  PanelI18nProvider,
  panelTranslator,
  savePanelLocale,
  usePanelI18n,
} from "./panel-i18n";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("panel message catalogs", () => {
  it("define exactly the same keys in every language", () => {
    const english = Object.keys(panelCatalogs.en).sort();
    const spanish = Object.keys(panelCatalogs.es).sort();
    expect(english.filter((key) => !spanish.includes(key)), "missing in Spanish").toEqual([]);
    expect(spanish.filter((key) => !english.includes(key)), "missing in English").toEqual([]);
    for (const [area, messages] of Object.entries(panelMessageAreas)) {
      expect(Object.keys(messages.es).sort(), area).toEqual(Object.keys(messages.en).sort());
    }
  });

  it("keep keys inside their area and never empty", () => {
    for (const [area, messages] of Object.entries(panelMessageAreas)) {
      for (const [key, text] of [...Object.entries(messages.en), ...Object.entries(messages.es)]) {
        expect(key.startsWith(`${area}.`), key).toBe(true);
        expect(String(text).trim(), key).not.toBe("");
      }
    }
  });

  it("use the same placeholders in every language", () => {
    for (const key of Object.keys(panelCatalogs.en) as Array<keyof typeof panelCatalogs.en>) {
      expect(placeholders(panelCatalogs.es[key]), key).toEqual(placeholders(panelCatalogs.en[key]));
    }
  });
});

describe("panel language", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("chooses Spanish for any es* browser language and English otherwise", () => {
    expect(detectPanelLocale("es")).toBe("es");
    expect(detectPanelLocale("es-MX")).toBe("es");
    expect(detectPanelLocale("ES-es")).toBe("es");
    expect(detectPanelLocale("en-GB")).toBe("en");
    expect(detectPanelLocale("ca")).toBe("en");
    expect(detectPanelLocale(undefined)).toBe("en");
  });

  it("prefers a saved choice and survives blocked storage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("navigator", { language: "es-ES" });
    vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
    expect(initialPanelLocale()).toBe("es");
    savePanelLocale("en");
    expect(store.get(PANEL_LOCALE_STORAGE_KEY)).toBe("en");
    expect(initialPanelLocale()).toBe("en");
    store.set(PANEL_LOCALE_STORAGE_KEY, "fr");
    expect(initialPanelLocale()).toBe("es");
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(initialPanelLocale()).toBe("es");
    expect(() => savePanelLocale("en")).not.toThrow();
  });

  it("fills placeholders and keeps unknown ones visible", () => {
    expect(formatPanelMessage("Page {page} of {count}", { page: 2, count: 5 })).toBe("Page 2 of 5");
    expect(formatPanelMessage("Hello {name}", {})).toBe("Hello {name}");
    expect(panelTranslator("es")("shell.pagination.page", { page: 1, count: 3 })).toBe("Página 1 de 3");
  });

  it("renders English outside the dashboard and the chosen language inside it", () => {
    function Label() { const { t } = usePanelI18n(); return <span>{t("shell.nav.history")}</span>; }
    expect(renderToStaticMarkup(<Label />)).toBe("<span>History</span>");
    expect(renderToStaticMarkup(<PanelI18nProvider locale="es" persist={false}><Label /></PanelI18nProvider>)).toBe("<span>Historial</span>");
  });
});

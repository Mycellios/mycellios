import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Overview } from "../NetworkOverview";
import { contributionErrorPresentation, nodePresentation } from "../Contribute";
import { SidebarFooter } from "../ui/Sidebar";
import { applyDocumentLanguage, PanelI18nProvider, panelTranslator } from "./panel-i18n";

const waiting = { capturedAt: new Date(0).toISOString(), summary: { registered: 0, online: 0, completedJobs: 0 }, workers: [], models: [], requestedModels: [], jobs: [] };
const noHistory = async () => [];

afterEach(() => { vi.unstubAllGlobals(); });

describe("panel screens follow the chosen language", () => {
  it("renders the Overview in Spanish and English from the catalogs", () => {
    const render = (locale: "es" | "en") => renderToStaticMarkup(<PanelI18nProvider locale={locale} persist={false}>
      <Overview snapshot={waiting} connectionError={null} onAddDevice={() => undefined} loadHistory={noHistory} now={0} />
    </PanelI18nProvider>);
    expect(render("es")).toContain("Estadísticas de la red");
    expect(render("es")).toContain("Esperando al coordinador");
    expect(render("en")).toContain("Network statistics");
    expect(render("en")).toContain("Waiting for the coordinator");
    expect(render("en")).not.toContain("Estadísticas");
  });

  it("translates contribution states and errors, keeping English as the default", () => {
    const es = panelTranslator("es");
    expect(contributionErrorPresentation("invalid_network_token", es).action).toBe("Iniciar sesión");
    expect(contributionErrorPresentation("invalid_network_token").action).toBe("Sign in");
    expect(nodePresentation({ connected: false, status: "revoked", observed: null } as never, es).label).toBe("Revocado");
  });

  it("offers the other language in the sidebar and follows it in <html lang>", () => {
    const footer = (locale: "es" | "en") => renderToStaticMarkup(<PanelI18nProvider locale={locale} persist={false}>
      <SidebarFooter accountLabel="" accountTitle="" onAccount={() => undefined} theme="light" onTheme={() => undefined} locale={locale} onLocale={() => undefined} status="" degraded={false} version="1" earnMenu={null} />
    </PanelI18nProvider>);
    expect(footer("es")).toContain('aria-label="Switch to English"');
    expect(footer("es")).toContain('lang="en"');
    expect(footer("en")).toContain('aria-label="Cambiar a español"');
    const without = renderToStaticMarkup(<SidebarFooter accountLabel="" accountTitle="" onAccount={() => undefined} theme="light" onTheme={() => undefined} status="" degraded={false} version="1" earnMenu={null} />);
    expect(without).not.toContain("panel-language-toggle");
    const root = { lang: "en" };
    const restore = applyDocumentLanguage(root, "es");
    expect(root.lang).toBe("es");
    restore?.();
    expect(root.lang).toBe("en");
  });
});

import { createRoot } from "react-dom/client";
import { I18nProvider } from "@lingui/react";
import { setupI18n } from "@lingui/core";
import { AppsOverlay } from "../../src/pages/AppsOverlay";
import "../../src/styles.css";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";

const bridge = (window as unknown as { studioFixture(input: unknown): Promise<unknown> })
  .studioFixture;
window.rakazoDesktop = { appsStudio: { request: bridge } } as never;
document.documentElement.lang = "es";
applyResolvedAppearance("light");
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={setupI18n({ locale: "es", messages: { es: {} } })}>
    <AppsOverlay
      scope="fixture-owner:fixture-space"
      onClose={() => {
        document.documentElement.dataset.closed = "true";
      }}
    />
  </I18nProvider>,
);

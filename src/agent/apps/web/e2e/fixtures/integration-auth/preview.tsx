import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { HifaStoreCatalog } from "../../../src/pages/marketplace/HifaStoreCatalog";
import { createRoot } from "react-dom/client";
import { activateUiLocale, i18n } from "../../../src/lib/i18n";
import { PluginsOverlay } from "../../../src/pages/PluginsOverlay";
import "./preview.css";

await activateUiLocale("es");
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <QueryClientProvider client={client}>
      <main
        style={{
          padding:
            "max(24px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left))",
        }}
      >
        <h1>Prueba local de integraciones</h1>
        <p>Datos simulados, sin cuentas ni conexiones reales.</p>
        {new URLSearchParams(location.search).has("cadencia") ? (
          <BrowserRouter>
            <HifaStoreCatalog scope="synthetic-ci-account-space" />
          </BrowserRouter>
        ) : (
          <PluginsOverlay onClose={() => location.reload()} />
        )}
      </main>
    </QueryClientProvider>
  </I18nProvider>,
);

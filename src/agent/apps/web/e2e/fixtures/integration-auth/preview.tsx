import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { activateUiLocale, i18n } from "../../../src/lib/i18n";
import { MarketplaceWorkspace } from "../../../src/pages/marketplace/MarketplaceWorkspace";
import "./preview.css";

await activateUiLocale("es");
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <QueryClientProvider client={client}>
      <main className="flex h-svh min-w-0 flex-col"
        style={{
          padding:
            "max(24px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left))",
        }}
      >
        <h1>Prueba local de integraciones</h1>
        <p>Datos simulados, sin cuentas ni conexiones reales.</p>
        <MarketplaceWorkspace
          tab="apps"
          onTab={() => {}}
          scope="integration-fixture"
          bots={[]}
          onExit={() => location.reload()}
          onMcp={() => {}}
          onCreated={() => {}}
          onOpenBot={() => {}}
          onBotsChanged={async () => {}}
          onCreateBot={() => {}}
        />
      </main>
    </QueryClientProvider>
  </I18nProvider>,
);

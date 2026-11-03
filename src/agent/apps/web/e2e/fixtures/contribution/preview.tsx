import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";
import { SidebarContribution } from "../../../src/components/SidebarContribution";
import { messages } from "../../../src/locales/es/messages.po";
import "../../../src/styles.css";

const i18n = setupI18n({ locale: "es", messages: { es: messages } });
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <main className="mx-auto max-w-lg p-8" style={{
      paddingTop: "max(32px, env(safe-area-inset-top))",
      paddingBottom: "max(32px, env(safe-area-inset-bottom))",
      paddingLeft: "max(32px, env(safe-area-inset-left))",
      paddingRight: "max(32px, env(safe-area-inset-right))",
    }}>
      <h1 className="mb-6 text-xl">Contribución del equipo</h1>
      <aside className="w-80 bg-sidebar py-4"><SidebarContribution /></aside>
      <output aria-label="Fixture actions" className="sr-only" />
    </main>
  </I18nProvider>,
);

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { messages as spanish } from "../../src/locales/es/messages.po";
import { OnboardingPage } from "../../src/pages/Onboarding";
import "../../src/styles.css";

// Actual application page; the runner owns all RPCs and blocks external traffic.
const locale = new URLSearchParams(location.search).get("lang") === "es" ? "es" : "en";
i18n.load(locale, locale === "es" ? spanish : {});
i18n.activate(locale);
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <MemoryRouter initialEntries={["/onboarding"]}>
      <Routes>
        <Route path="/onboarding/:step?" element={<OnboardingPage />} />
        <Route path="/app/:botId?" element={<p data-testid="team-created">Profiles ready</p>} />
      </Routes>
    </MemoryRouter>
  </I18nProvider>,
);

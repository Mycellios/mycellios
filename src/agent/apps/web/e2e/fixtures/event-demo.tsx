import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";
import { EventDemoPage } from "../../src/pages/demo/EventDemo";
import "../../src/styles.css";
i18n.load("en", {}); i18n.activate("en");
const presenter = new URLSearchParams(location.search).has("present");
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}>
  <p style={{ position: "fixed", insetInlineStart: 8, bottom: 0, fontSize: 9, opacity: .7, zIndex: 20 }}>Isolated fixture · fictional credits · no paid provider</p>
  <EventDemoPage id="test-only-event" presenter={presenter} />
</I18nProvider>);

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";
import { DemoPresenter } from "../../src/pages/demo/Presenter";
import "../../src/styles.css";
import "../../src/pages/demo/event-demo.css";
i18n.load("en", {}); i18n.activate("en");
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}>
  <DemoPresenter id="test-only-event" />
  <p style={{ margin: 0, padding: 10, textAlign: "center", fontSize: 12 }}>Isolated design test · fictional devices · no paid inference</p>
</I18nProvider>);

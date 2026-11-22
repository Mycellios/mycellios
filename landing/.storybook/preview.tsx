import type { Preview } from "@storybook/react-vite";
import { useLayoutEffect } from "react";
import { applyDesignProfile } from "../src/ui/design-profile";
import { PanelI18nProvider } from "../src/i18n/panel-i18n";
import "../src/brand-tokens.css";
import "../src/panel.css";
import "../src/panel-desktop.css";
import "../src/panel-downloads.css";
import "../src/button-style.css";
import "../src/logo-style.css";
import "../src/ui/ui.css";
import "../src/ui/dark-theme.css";

const preview: Preview = {
  globalTypes: {
    theme: { description: "Production theme", toolbar: { icon: "circlehollow", items: ["light", "dark"], dynamicTitle: true } },
    design: { description: "Design profile", toolbar: { icon: "paintbrush", items: ["agent", "classic"], dynamicTitle: true } },
    locale: { description: "Dashboard panel language", toolbar: { icon: "globe", items: [{ value: "es", title: "Español" }, { value: "en", title: "English" }], dynamicTitle: true } },
  },
  initialGlobals: { theme: "light", design: "agent", locale: "es" },
  decorators: [(Story, context) => {
    useLayoutEffect(() => { applyDesignProfile(context.globals.design === "classic" ? "classic" : "agent"); }, [context.globals.design]);
    // Panel screens read the dashboard language; marketing stories ignore it.
    return <PanelI18nProvider locale={context.globals.locale === "en" ? "en" : "es"} persist={false}><div className="public-panel-viewport">{context.parameters.ownsThemeRoot ? <Story /> : <div className={`public-panel theme-${context.globals.theme}`} style={{ display: "block", minHeight: "100vh", padding: 32 }}><Story /></div>}</div></PanelI18nProvider>;
  }],
  parameters: { layout: "fullscreen", controls: { expanded: true } },
};
export default preview;

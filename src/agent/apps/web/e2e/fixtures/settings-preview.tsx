import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { DEFAULT_DESKTOP_COMPANIONS, type DesktopCompanionPreferences, type RakazoDesktop } from "@rakazo/contracts";
import { createRoot } from "react-dom/client";
import { DesktopCompanionsPanel } from "../../src/pages/settings/DesktopCompanionsPanel";
import { ServerLinkCode } from "../../src/components/ServerLinkCode";
import { FloatingChatButton } from "../../src/components/FloatingChatButton";
import "../../src/styles.css";

// Presentation only: native calls are recorded, no accounts or real windows.
i18n.load("en", {}); i18n.activate("en");
let preferences = structuredClone(DEFAULT_DESKTOP_COMPANIONS);
preferences.dock.shown = true;
const calls: unknown[] = [];
(window as any).__settingsFixture = { calls };
window.rakazoDesktop = { companions: {
  state: async () => preferences,
  save: async (next: DesktopCompanionPreferences) => { preferences = next; calls.push(next); return next; },
  displays: async () => [{ id: 1, label: "Primary screen" }],
  openChat: async target => { calls.push(target); },
} } as RakazoDesktop;
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}>
  <main className="min-h-dvh bg-background p-6 text-foreground">
    <p className="mb-4 text-sm text-muted-foreground">Synthetic settings preview · no real account or native actions</p>
    <div className="mx-auto max-w-3xl space-y-8">
      <DesktopCompanionsPanel kind="dock" bots={[]} />
      <FloatingChatButton userId="fixture-owner" spaceId="fixture-space" botId="fixture-mico" />
      <ServerLinkCode url="https://www.mycellios.com/agent/" />
    </div>
  </main>
</I18nProvider>);

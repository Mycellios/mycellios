import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { DesktopUpdateState, RakazoDesktop } from "@rakazo/contracts";
import { createRoot } from "react-dom/client";
import { DesktopSidebarUpdate, DesktopUpdatesProvider } from "../../src/components/DesktopUpdates";
import "../../src/styles.css";

// Presentation fixture only. No real installer, account or shutdown capability.
i18n.load("en", {}); i18n.activate("en");
document.documentElement.dataset.theme = "dark";
const scenario = new URLSearchParams(location.search).get("scenario");
let state: DesktopUpdateState = {
  phase: scenario === "error" ? "error" : scenario === "downloading" ? "downloading" : "ready",
  currentVersion: "0.3.33", availableVersion: "0.3.35", percent: 72, checkedAt: null,
  message: scenario === "error" ? "Could not complete the update. Try again." : null,
};
const calls: string[] = [];
(window as any).__updateFixture = { calls };
window.rakazoDesktop = { update: {
  state: async () => state,
  install: async () => { calls.push("install"); state = { ...state, installPending: true }; return state; },
  cancelInstall: async () => { calls.push("cancel"); state = { ...state, installPending: false }; return state; },
  check: async () => { calls.push("check"); return state; },
  onPrepare: () => () => {},
} } as unknown as RakazoDesktop;
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}>
  <DesktopUpdatesProvider>
    <div className="flex h-dvh bg-background text-foreground">
      <aside className="flex w-72 shrink-0 flex-col bg-sidebar py-4">
        <p className="px-5 text-sm font-medium">Mycellios</p>
        <p className="px-5 pt-3 text-xs text-muted-foreground">Synthetic preview · no account or installer</p>
        <div className="flex-1" /><DesktopSidebarUpdate />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col p-8">
        <h1 className="text-lg font-medium">Mico</h1>
        <p className="mt-8 text-sm text-muted-foreground">You can keep using your chat while an update waits.</p>
        <textarea aria-label="Chat draft" defaultValue="My unsent draft" className="mt-auto rounded-xl border border-border bg-muted p-4" />
      </main>
    </div>
  </DesktopUpdatesProvider>
</I18nProvider>);

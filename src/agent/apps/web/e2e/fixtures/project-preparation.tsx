import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import type { ProjectRunState, RakazoDesktop } from "@rakazo/contracts";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ReviewWorkspaceProvider, useReviewWorkspace } from "../../src/lib/review-workspace";
import { ReviewWorkspacePanel } from "../../src/components/ReviewWorkspacePanel";
import { messages } from "../../src/locales/es/messages.po";
import "../../src/styles.css";

i18n.load("es", messages); i18n.activate("es");
const query = new URL(location.href).searchParams;
const preview = query.get("preview")!;
const failure = query.has("failure");
let requests = 0, cancelled = 0, status = "queued", detail = "";
let state: ProjectRunState = { phase: "idle", profiles: [], services: [], urls: [], logs: "" };
window.rakazoDesktop = {
  computer: { requestAccess: async () => true, connect: async () => {} },
  projectRunner: {
    state: async () => structuredClone(state),
    play: async () => {
      if (state.phase === "idle") state = { ...state, phase: "preparing", preparation: { id: "fixture-request", prompt: "INTERNAL_SETUP_PROMPT_MUST_NOT_APPEAR" } };
      else state = { phase: "running", project: "Proyecto local", profiles: [], services: [{ id: "web", phase: "running", owned: true }], urls: [{ name: "Web", url: preview }], logs: "[web] Ready on loopback" };
      return structuredClone(state);
    },
    stop: async () => { state = { ...state, phase: "stopped", services: [], urls: [] }; return structuredClone(state); },
  },
} as unknown as RakazoDesktop;

function Workspace() {
  const review = useReviewWorkspace()!;
  useEffect(() => review.show(), []);
  return <div className="relative flex h-dvh min-h-0 min-w-0 bg-background text-foreground">
    <main data-testid="main-chat" className="min-w-0 flex-1 p-6">
      <h1 className="text-lg font-medium">Proyecto local</h1>
      <p className="mt-4 text-sm">Quiero revisar la interfaz.</p>
    </main>
    <ReviewWorkspacePanel botId="fixture-bot" prepareProject={async () => {
      requests++; status = "running";
      setTimeout(() => {
        if (cancelled) return;
        status = failure ? "failed" : "completed";
        detail = failure ? "Falta instalar una dependencia local." : "Configuración local preparada.";
        if (!failure) state = { ...state, phase: "configured" };
      }, 2300);
      return "auxiliary-run";
    }} inspectPreparation={async () => ({ status, detail })} cancelPreparation={async () => { cancelled++; status = "cancelled"; }} />
  </div>;
}
Object.defineProperty(window, "preparationFixture", { value: { counts: () => ({ requests, cancelled }) } });
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><ReviewWorkspaceProvider scope="fixture-chat"><Workspace /></ReviewWorkspaceProvider></I18nProvider>);

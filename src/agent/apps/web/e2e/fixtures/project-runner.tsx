import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import type { ProjectRunState, RakazoDesktop } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReviewWorkspaceProvider, useReviewWorkspace } from "../../src/lib/review-workspace";
import { ReviewWorkspacePanel } from "../../src/components/ReviewWorkspacePanel";
import { messages } from "../../src/locales/es/messages.po";
import "../../src/styles.css";
i18n.load("es", messages); i18n.activate("es");
const preview = new URL(location.href).searchParams.get("preview")!;
let preparations = 0;
let state: ProjectRunState = { phase: "idle", services: [], profiles: [], urls: [], logs: "" };
const profiles = [{ id: "web", name: "Solo frontend" }, { id: "all", name: "Aplicación completa" }];
window.rakazoDesktop = {
  computer: { requestAccess: async () => true, connect: async () => {}, connected: async () => true },
  projectRunner: {
    state: async () => structuredClone(state),
    play: async request => {
      if (state.phase === "idle") state = { ...state, phase: "preparing", preparation: { id: "fixture-request", prompt: "Prepare fixture config" } };
      else if (state.phase === "configured" || state.phase === "stopped") {
        const count = request.profile === "all" ? 3 : 1;
        state = { phase: "running", project: "Proyecto de ejemplo", profile: request.profile ?? "web", profiles,
          services: ["web", "api", "worker"].slice(0, count).map(id => ({ id, phase: "running", owned: true })),
          urls: [{ name: "Frontend", url: preview }], logs: "[web] Ready on loopback\n[api] Healthy\n[worker] Waiting for jobs\n" };
      }
      return structuredClone(state);
    },
    stop: async () => { state = { ...state, phase: "stopped", services: [], urls: [] }; return structuredClone(state); },
  },
} as unknown as RakazoDesktop;
function Workspace() {
  const review = useReviewWorkspace()!;
  const [prepared, setPrepared] = useState(0);
  useEffect(() => review.show(), []);
  return <div className="relative flex h-dvh min-h-0 min-w-0 bg-background text-foreground">
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="border-b border-border p-4 text-sm font-medium">Proyecto de ejemplo</header>
      <p className="p-6 text-sm">Preparaciones del agente: <span id="preparations">{prepared}</span></p>
    </main>
    <ReviewWorkspacePanel botId="fixture-bot" prepareProject={async () => {
      preparations++; setPrepared(preparations);
      state = { ...state, phase: "configured", profiles };
      return undefined;
    }} />
  </div>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><ReviewWorkspaceProvider scope="fixture-chat"><Workspace /></ReviewWorkspaceProvider></I18nProvider>);

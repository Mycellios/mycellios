import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";
import type { DesktopUpdateState, RakazoDesktop } from "@rakazo/contracts";
import { DesktopUpdatesProvider, DesktopSidebarUpdate } from "../../src/components/DesktopUpdates";
import { messages } from "../../src/locales/es/messages.po";
import "../../src/styles.css";

// Presentation-only native bridge. It cannot fetch releases, execute installers or quit an app.
let state: DesktopUpdateState = { phase: "downloading", currentVersion: "0.3.43", availableVersion: "0.3.44",
  percent: 37, message: null, checkedAt: null, autoInstallEnabled: true };
let downloadTimer: ReturnType<typeof setInterval> | undefined;
const snapshot = async () => ({ ...state });
function show(patch: Partial<DesktopUpdateState>) {
  clearInterval(downloadTimer);
  state = { ...state, installPending: false, relaunchPending: false, automaticRestartAt: undefined, message: null, ...patch };
}
window.rakazoDesktop = { update: { state: snapshot, check: snapshot, onPrepare: () => () => {},
  download: async () => {
    show({phase:"downloading",percent:0});
    downloadTimer = setInterval(() => { const value = (state.percent ?? 0) + 9;
      state = { ...state, percent: Math.min(100,value), phase: value >= 100 ? "ready" : "downloading" };
      if(value >= 100) clearInterval(downloadTimer);
    },700); return snapshot();
  },
  install: async () => { state = { ...state, relaunchPending:true, automaticRestartAt:Date.now()+15_000 }; return snapshot(); },
  cancelRestart: async () => { show({phase:"ready"}); return snapshot(); },
  cancelInstall: async () => { show({phase:"ready"}); return snapshot(); },
} } as unknown as RakazoDesktop;
const i18n=setupI18n({locale:"es",messages:{es:messages}});
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><DesktopUpdatesProvider>
  <div className="flex min-h-dvh bg-background text-foreground">
    <aside className="flex w-[288px] shrink-0 flex-col border-r border-border bg-sidebar py-5">
      <p className="px-5 text-sm">Mycellios</p><p className="px-5 pt-6 text-xs text-muted-foreground">PERSONAL</p>
      <div className="mx-3 mt-3 flex items-center gap-3 rounded-xl bg-background px-3 py-3"><img src="/mycellios/mico.png" alt="" className="size-9 object-contain"/><span className="text-sm">Mico</span></div>
      <div className="mt-auto"><DesktopSidebarUpdate/><p className="px-5 pb-1 pt-4 text-xs text-muted-foreground">Dani</p></div>
    </aside>
    <main className="flex flex-1 flex-col p-8"><p className="text-sm">Vista previa de actualizaciones</p>
      <p className="mt-2 text-xs text-muted-foreground">Solo demostración. No descarga ni instala versiones reales.</p>
      <div className="mt-6 flex flex-wrap gap-3">{([['Disponible','available',null],['Descarga','downloading',37],['Lista','ready',100],['Error','error',null]] as const).map(([label,phase,percent])=>
        <button key={phase} className="rounded-lg bg-muted px-3 py-2 text-xs" onClick={()=>show({phase,percent,message:phase==='error'?'No se ha podido descargar la actualización.':null})}>{label}</button>)}
        <button className="rounded-lg bg-muted px-3 py-2 text-xs" onClick={()=>show({phase:'ready',relaunchPending:true,automaticRestartAt:Date.now()+60_000})}>Automática</button>
        <button className="rounded-lg bg-muted px-3 py-2 text-xs" onClick={()=>document.documentElement.dataset.theme=document.documentElement.dataset.theme==='light'?'dark':'light'}>Cambiar tema</button>
      </div>
      <div className="my-auto max-w-lg rounded-2xl bg-muted p-4 text-sm">Puedes seguir conversando mientras Mycellios prepara la actualización.</div>
    </main>
  </div>
</DesktopUpdatesProvider></I18nProvider>);

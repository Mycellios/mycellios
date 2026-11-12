import type { Bot } from "@rakazo/contracts";
import { ArrowUpRight, Film, Monitor } from "lucide-react";
import { appPath } from "../../lib/app-path";
import { desktopBridge } from "../../lib/desktop";
import { AppCover } from "./AppCover";
import { matches } from "./catalog";
import "./mycellios-apps.css";

export const FIRST_PARTY_APPS = [
  { id: "video-edit", title: "Editar vídeo", description: "Transforma tus clips con IA y revisa el precio en créditos.",
    context: "Edita un MP4 existente mediante una instrucción. Importa, revisa el presupuesto y confirma antes de pagar. No modifica un vídeo sin tu aprobación." },
  { id: "video-studio", title: "Estudio de vídeos", description: "Crea vídeos verticales con narración.",
    context: "Convierte un tema en un MP4 vertical 9:16 de seis escenas tipográficas con narración. El usuario revisa el guion y la voz antes de exportar. Funciona en Desktop para Windows. No genera filmaciones ni publica en redes." },
];

export function matchingFirstPartyApps(query: string) {
  return FIRST_PARTY_APPS.filter(app => matches(query, app.title, app.description, "Vídeo y audio"));
}

/** Keep existing Desktop launchers and personal covers inside the shared Store grid. */
export function FirstPartyApps({ query, bots, scope, activeBotId, onOpenEdit, onOpenStudio }: {
  query: string; bots: Bot[]; scope: string; activeBotId?: string;
  onOpenEdit: () => void; onOpenStudio?: () => void;
}) {
  const canCreate = Boolean(desktopBridge()?.appsStudio);
  return <>{matchingFirstPartyApps(query).map(app => (
    <article key={app.id} className="mycellios-app-card" aria-labelledby={`${app.id}-title`}>
      <AppCover app={app} bots={bots} scope={scope} activeBotId={activeBotId}
        fallback={app.id === "video-edit" ? <div className="mycellios-app-preview">
          <img className="mycellios-app-cover-image" src={appPath("/mycellios/video-edit-cover-v1.png")}
            alt="Edición de vídeo: una escena costera pasa de tonos grises a un acabado cinematográfico cálido" width={1536} height={1024} />
        </div> : undefined} />
      <div className="mycellios-app-card-copy">
        <div className="mycellios-app-card-heading">
          <span className="mycellios-app-icon"><Film size={20} strokeWidth={1.6} aria-hidden="true" /></span>
          <h2 id={`${app.id}-title`}>{app.title}</h2>
        </div>
        <p className="mycellios-app-description">{app.description}</p>
        <div className="mycellios-app-card-footer">
          <span><Monitor size={13} aria-hidden="true" /> Desktop · Windows</span>
          <button type="button" className="mycellios-app-open"
            aria-label={`${canCreate ? "Abrir" : "Ver"} ${app.title}`}
            disabled={app.id === "video-studio" && !onOpenStudio}
            onClick={app.id === "video-edit" ? onOpenEdit : onOpenStudio}>
            <ArrowUpRight size={17} aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  ))}</>;
}

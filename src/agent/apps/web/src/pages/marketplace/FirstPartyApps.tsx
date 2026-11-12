import type { Bot } from "@rakazo/contracts";
import { Film, Monitor, Globe2, Sparkles } from "lucide-react";
import { appPath } from "../../lib/app-path";
import { desktopBridge } from "../../lib/desktop";
import { StoreAppCard } from "./StoreAppCard";
import { AppCover } from "./AppCover";
import { matches } from "./catalog";
import "./mycellios-apps.css";

export const FIRST_PARTY_APPS = [
  { id: "ai-studio", title: "Estudio IA", description: "Crea imágenes, voz y vídeos a partir de una idea.", context: "Genera contenido con los modelos disponibles en Mycellios. Revisa el precio y confirma antes de crear." },
  { id: "video-edit", title: "Editar vídeo", description: "Transforma tus clips con IA y revisa el precio en créditos.",
    context: "Edita un MP4 existente mediante una instrucción. Importa, revisa el presupuesto y confirma antes de pagar. No modifica un vídeo sin tu aprobación." },
  { id: "video-studio", title: "Estudio de vídeos", description: "Crea vídeos verticales con narración.",
    context: "Convierte un tema en un MP4 vertical 9:16 de seis escenas tipográficas con narración. El usuario revisa el guion y la voz antes de exportar. Funciona en Desktop para Windows. No genera filmaciones ni publica en redes." },
];

export function matchingFirstPartyApps(query: string) {
  return FIRST_PARTY_APPS.filter(app => matches(query, app.title, app.description, "Vídeo y audio"));
}

/** Keep existing Desktop launchers and personal covers inside the shared Store grid. */
export function FirstPartyApps({ query, bots, scope, activeBotId, onOpenEdit, onOpenStudio, onOpenCreate }: {
  query: string; bots: Bot[]; scope: string; activeBotId?: string;
  onOpenEdit: () => void; onOpenStudio?: () => void; onOpenCreate: () => void;
}) {
  const canCreate = Boolean(desktopBridge()?.appsStudio);
  return <>{matchingFirstPartyApps(query).map(app => (
    <StoreAppCard key={app.id} title={app.title} description={app.description}
      icon={app.id === "ai-studio" ? <Sparkles size={18} /> : <Film size={18} strokeWidth={1.6} />}
      metadata={app.id === "ai-studio" ? <><Globe2 size={13} aria-hidden="true" /> En este navegador</> : <><Monitor size={13} aria-hidden="true" /> Escritorio</>}
      onOpen={app.id === "ai-studio" ? onOpenCreate : app.id === "video-edit" ? onOpenEdit : () => onOpenStudio?.()}
      openLabel={`${app.id === "ai-studio" || canCreate ? "Abrir" : "Ver"} ${app.title}`}
      disabled={app.id === "video-studio" && !onOpenStudio}
      cover={<AppCover app={app} bots={bots} scope={scope} activeBotId={activeBotId}
        fallback={app.id === "ai-studio" ? <div className="mycellios-app-preview"><img className="mycellios-app-cover-image" src={appPath("/mycellios/studio-ia-cover-v1.png")} alt="Estudio creativo con imagen, onda de voz y vídeo en tonos verdes" width={1536} height={1024} /></div> : app.id === "video-edit" ? <div className="mycellios-app-preview">
          <img className="mycellios-app-cover-image" src={appPath("/mycellios/video-edit-cover-v1.png")}
            alt="Edición de vídeo: una escena costera pasa de tonos grises a un acabado cinematográfico cálido" width={1536} height={1024} />
        </div> : undefined} />}
    />
  ))}</>;
}

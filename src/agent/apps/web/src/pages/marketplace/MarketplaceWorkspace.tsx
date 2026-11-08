import { useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import { Button, Input } from "@rakazo/ui-web";
import { ArrowLeft, Blocks, BookOpen, Bot as BotIcon, LayoutGrid, Monitor, Search } from "lucide-react";
import { useState } from "react";
import type { connectedAppMarks } from "../../lib/connected-apps";
import { VideoStudioSample } from "../../components/VideoStudioSample";
import { desktopBridge, desktopDragClass } from "../../lib/desktop";
import { PluginsOverlay } from "../PluginsOverlay";
import { AgentsMarketplace } from "./AgentsMarketplace";
import { matches, type MarketplaceTab } from "./catalog";
import { SkillsMarketplace } from "./SkillsMarketplace";
import "./marketplace.css";

export function MarketplaceWorkspace(props: {
  tab: MarketplaceTab;
  onTab: (tab: MarketplaceTab) => void;
  scope: string;
  bots: Bot[];
  activeBotId?: string;
  onExit: () => void;
  onMcp: () => void;
  onCreated: (bot: Bot) => void;
  onOpenBot: (id: string) => void;
  onBotsChanged: () => Promise<void>;
  onCreateBot: () => void;
  onOpenStudio?: () => void;
  onConnectedAppsChange?: (apps: ReturnType<typeof connectedAppMarks>) => void;
}) {
  const { t } = useLingui();
  const tabs = [
    ...(props.onOpenStudio
      ? [{ id: "mycellios-apps" as const, label: "Apps de Mycellios", icon: LayoutGrid }]
      : []),
    { id: "apps" as const, label: props.onOpenStudio ? t`Integrations` : t`Apps`, icon: Blocks },
    { id: "agents" as const, label: t`Micos`, icon: BotIcon },
    { id: "skills" as const, label: t`Skills`, icon: BookOpen },
  ];
  return (
    <section className="rk-marketplace" data-testid="marketplace-workspace">
      <header className={`rk-market-topbar ${desktopDragClass()}`} data-testid="conversation-header">
        <Button
          variant="ghost"
          size="icon-sm"
          className="app-no-drag"
          aria-label={t`Back to chat`}
          onClick={props.onExit}
        >
          <ArrowLeft size={16} />
        </Button>
        <span>Marketplace</span>
      </header>
      <div className="rk-market-layout">
        <aside className="rk-market-nav">
          <div className="rk-market-nav-title">
            <h2>Marketplace</h2>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Back to chat`}
              onClick={props.onExit}
            >
              <ArrowLeft size={15} />
            </Button>
          </div>
          <nav aria-label={t`Marketplace sections`}>
            {tabs.map(({ id, label, icon: Icon }) => (
              <Button
                variant="ghost"
                key={id}
                aria-current={id === props.tab ? "page" : undefined}
                onClick={() => props.onTab(id)}
              >
                <Icon size={16} strokeWidth={1.6} />
                <span>{label}</span>
              </Button>
            ))}
          </nav>
        </aside>
        <div className="rk-market-content rk-scroll" key={`${props.scope}:${props.tab}`}>
          {props.tab === "mycellios-apps" && props.onOpenStudio ? (
            <MycelliosAppsCatalog onOpenStudio={props.onOpenStudio} />
          ) : props.tab === "apps" || props.tab === "mycellios-apps" ? (
            <PluginsOverlay
              onConnectedAppsChange={props.onConnectedAppsChange}
              activeBotId={props.activeBotId}
              onClose={props.onExit}
              onOpenMcp={props.onMcp}
            />
          ) : props.tab === "agents" ? (
            <AgentsMarketplace
              bots={props.bots}
              scope={props.scope}
              onCreated={props.onCreated}
              onOpen={props.onOpenBot}
              onChanged={props.onBotsChanged}
              onCreate={props.onCreateBot}
            />
          ) : (
            <SkillsMarketplace bots={props.bots} />
          )}
        </div>
      </div>
    </section>
  );
}

function MycelliosAppsCatalog({ onOpenStudio }: { onOpenStudio: () => void }) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const title = "Estudio de vídeos";
  const description = "Crea vídeos verticales con narración en tu PC.";
  const canCreate = Boolean(desktopBridge()?.appsStudio);

  return (
    <>
      <div className="rk-market-heading">
        <div>
          <h1>Apps de Mycellios</h1>
          <p>Herramientas que puedes abrir directamente desde Mycellios.</p>
        </div>
      </div>
      <div className="rk-market-search">
        <div className="rk-market-search-field">
          <Search size={16} aria-hidden="true" />
          <Input type="search" aria-label={t`Search`} placeholder={t`Search`} value={query}
            onChange={(event) => setQuery(event.target.value)} />
        </div>
      </div>
      {matches(query, title, description, "Vídeo y audio") ? (
        <section className="rk-market-group">
          <h2>Vídeo y audio <span>1</span></h2>
          <div className="rk-market-rows">
            <article className="max-w-lg space-y-3 rounded-xl border border-border p-3 sm:p-4">
              <VideoStudioSample />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold">{title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                </div>
                <Button variant="secondary" className="min-h-11 md:min-h-0"
                  aria-label={canCreate ? "Abrir Estudio de vídeos" : "Ver Estudio de vídeos"} onClick={onOpenStudio}>
                  {canCreate ? t`Open` : t`View details`}
                </Button>
              </div>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Monitor size={14} aria-hidden="true" /> Mycellios Desktop
              </p>
            </article>
          </div>
        </section>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">No se encontraron apps.</p>
      )}
    </>
  );
}

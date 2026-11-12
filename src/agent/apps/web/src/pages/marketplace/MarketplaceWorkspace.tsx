import { useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import {
  ArrowLeft,
  Blocks,
  BookOpen,
  Bot as BotIcon,
  LayoutGrid,
} from "lucide-react";
import type { connectedAppMarks } from "../../lib/connected-apps";
import { desktopDragClass } from "../../lib/desktop";
import { PluginsOverlay } from "../PluginsOverlay";
import { AgentsMarketplace } from "./AgentsMarketplace";
import { type MarketplaceTab } from "./catalog";
import { SkillsMarketplace } from "./SkillsMarketplace";
import { HostedWebs } from "./HostedWebs";
import "./marketplace.css";
import "./mycellios-apps.css";

export function MarketplaceWorkspace(props: {
  tab: MarketplaceTab;
  onTab: (tab: MarketplaceTab) => void;
  scope: string;
  spaceId?: string | null;
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
    { id: "mycellios-apps" as const, label: "Hifa Store", icon: LayoutGrid },
    { id: "apps" as const, label: t`Integrations`, icon: Blocks },
    { id: "agents" as const, label: t`Micos`, icon: BotIcon },
    { id: "skills" as const, label: t`Skills`, icon: BookOpen },
  ];
  return (
    <section className="rk-marketplace" data-testid="marketplace-workspace">
      <header
        className={`rk-market-topbar ${desktopDragClass()}`}
        data-testid="conversation-header"
      >
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
        <div
          className="rk-market-content rk-scroll"
          key={`${props.scope}:${props.tab}`}
        >
          {props.tab === "mycellios-apps" ? (
            <HostedWebs
              scope={props.scope}
              spaceId={props.spaceId}
              bots={props.bots}
              activeBotId={props.activeBotId}
              onOpenStudio={props.onOpenStudio}
              onOpenBot={props.onOpenBot}
              onCreateBot={props.onCreateBot}
            />
          ) : props.tab === "apps" ? (
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

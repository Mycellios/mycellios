import { useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { useId, useState } from "react";
import {
  ArrowLeft,
  Blocks,
  BookOpen,
  Bot as BotIcon,
  ChevronLeft,
  ChevronRight,
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

const MENU_PREFERENCE = "mycellios:marketplace:menu-collapsed";

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
  const navigationId = useId();
  const [menuCollapsed, setMenuCollapsed] = useState(() => {
    try { return localStorage.getItem(MENU_PREFERENCE) === "1"; }
    catch { return false; }
  });
  const menuLabel = menuCollapsed ? t`Expand Marketplace menu` : t`Collapse Marketplace menu`;
  function toggleMenu() {
    const next = !menuCollapsed;
    setMenuCollapsed(next);
    try { localStorage.setItem(MENU_PREFERENCE, next ? "1" : "0"); }
    catch { /* The menu still works when browser storage is unavailable. */ }
  }
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
        <span>Marketplace</span>
        <Button
          variant="ghost"
          size="sm"
          className="app-no-drag rk-market-menu-toggle"
          aria-label={menuLabel}
          title={menuLabel}
          aria-expanded={!menuCollapsed}
          aria-controls={navigationId}
          onClick={toggleMenu}
        >
          {menuCollapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronLeft size={14} aria-hidden="true" />}
          {menuCollapsed ? t`Show menu` : t`Hide menu`}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="app-no-drag rk-market-back"
          aria-label={t`Back to chat`}
          title={t`Back to chat`}
          onClick={props.onExit}
        >
          <ArrowLeft size={16} />
        </Button>
      </header>
      <div className="rk-market-layout">
        <aside className="rk-market-nav" id={navigationId} hidden={menuCollapsed}>
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

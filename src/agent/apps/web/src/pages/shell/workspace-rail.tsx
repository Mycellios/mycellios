import { useLingui } from "@lingui/react/macro";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@rakazo/ui-web";
import {
  Bell,
  Bot,
  CalendarClock,
  ChartArea,
  FolderOpen,
  ListTodo,
  MoreHorizontal,
  Pin,
  Settings,
  SquareKanban,
  Store,
  Waypoints,
  Workflow,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconTooltip } from "../../components/IconTooltip";
import { MycelliosWordmark } from "../../components/MycelliosBrand";
import { desktopBridge, windowChromeKind } from "../../lib/desktop";
import {
  type RailPage,
  railPinsKey,
  readRailPins,
  writeRailPins,
} from "../../lib/workspace-rail-pins";
import { WindowChrome } from "../WindowChrome";
import { ProviderQuota } from "../../components/ProviderQuota";
import { HelpMenu } from "../../components/HelpMenu";

type WorkspaceRailProps = {
  scope: string;
  activity: boolean;
  usage?: boolean;
  marketplace?: boolean;
  schedule?: boolean;
  onSchedule?: () => void;
  tasks?: boolean;
  onTasks?: () => void;
  workflows?: boolean;
  onWorkflows?: () => void;
  routines?: boolean;
  onRoutines?: () => void;
  onChats: () => void;
  onActivity: () => void;
  onArtifacts: () => void;
  onIntegrations: () => void;
  onUsage: () => void;
  onSettings: () => void;
  onModels?: () => void;
  onWhatsNew?: () => void;
  onBoard?: () => void;
};

export function WorkspaceRail(props: WorkspaceRailProps) {
  return <WorkspaceRailContent key={props.scope} {...props} />;
}

function WorkspaceRailContent(props: WorkspaceRailProps) {
  const { t } = useLingui();
  const desktop = desktopBridge();
  const [pins, setPins] = useState(() => readRailPins(props.scope));
  const [menuOpen, setMenuOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const anchor = useRef<{ getBoundingClientRect: () => DOMRect } | null>(null);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === null || event.key === railPinsKey(props.scope))
        setPins(readRailPins(props.scope));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [props.scope]);
  const pages: {
    id: RailPage;
    label: string;
    icon: typeof Bot;
    action: () => void;
    current?: boolean;
    extra?: boolean;
  }[] = [
    ...(props.onRoutines
      ? [
          {
            id: "routines" as const,
            label: t`Routines`,
            icon: Workflow,
            action: props.onRoutines,
            current: props.routines,
          },
        ]
      : []),
    ...(props.onWorkflows
      ? [
          {
            id: "workflows" as const,
            label: t`Workflows`,
            icon: Waypoints,
            action: props.onWorkflows,
            current: props.workflows,
          },
        ]
      : []),
    ...(props.onTasks
      ? [
          {
            id: "tasks" as const,
            label: t`Tasks`,
            icon: ListTodo,
            action: props.onTasks,
            current: props.tasks,
          },
        ]
      : []),
    ...(props.onSchedule
      ? [
          {
            id: "schedule" as const,
            label: t`Schedule`,
            icon: CalendarClock,
            action: props.onSchedule,
            current: props.schedule,
          },
        ]
      : []),
    { id: "usage", label: t`Usage`, icon: ChartArea, action: props.onUsage, current: props.usage },
    {
      id: "activity",
      label: t`Activity`,
      icon: Bell,
      action: props.onActivity,
      current: props.activity,
      extra: true,
    },
    { id: "files", label: t`Files`, icon: FolderOpen, action: props.onArtifacts, extra: true },
    {
      id: "marketplace",
      label: t`Marketplace`,
      icon: Store,
      action: props.onIntegrations,
      current: props.marketplace,
      extra: true,
    },
    ...(props.onBoard
      ? [
          {
            id: "board" as const,
            label: t`Board`,
            icon: SquareKanban,
            action: props.onBoard,
            extra: true,
          },
        ]
      : []),
  ];
  const togglePin = (id: RailPage, checked: boolean) => {
    setPins((current) => {
      const next = checked
        ? [...current.filter((page) => page !== id), id]
        : current.filter((page) => page !== id);
      writeRailPins(props.scope, next);
      return next;
    });
  };
  return (
    <nav
      data-testid="workspace-rail"
      className="rk-workspace-rail"
      aria-label={t`Workspace navigation`}
    >
      <div className="app-drag flex h-[51px] shrink-0 items-center justify-center">
        {windowChromeKind(desktop) === "controls" ? (
          <WindowChrome />
        ) : !desktop || desktop.platform === "win32" ? (
          <MycelliosWordmark compact />
        ) : null}
      </div>
      <div className="rk-rail-pages flex flex-col items-center gap-1">
        <IconTooltip label={t`Micos`}>
          <Button
            variant="ghost"
            size="icon"
            className="app-no-drag rk-rail-button"
            aria-label={t`Micos`}
            aria-current={pages.some((page) => page.current) ? undefined : "page"}
            onClick={props.onChats}
          >
            <Bot size={19} strokeWidth={1.6} aria-hidden="true" />
          </Button>
        </IconTooltip>
        {pages
          .filter((page) => pins.includes(page.id))
          .map(({ id, label, icon: Icon, action, current }) => (
            <IconTooltip key={id} label={label}>
              <Button
                variant="ghost"
                size="icon"
                className="app-no-drag rk-rail-button"
                aria-label={label}
                aria-current={current ? "page" : undefined}
                onClick={action}
              >
                <Icon size={19} strokeWidth={1.6} aria-hidden="true" />
              </Button>
            </IconTooltip>
          ))}
        <DropdownMenu
          open={menuOpen}
          onOpenChange={(open) => {
            if (open && trigger.current) {
              const rect = trigger.current.getBoundingClientRect();
              anchor.current = { getBoundingClientRect: () => rect };
            }
            setMenuOpen(open);
          }}
        >
          <DropdownMenuTrigger
            ref={trigger}
            className="app-no-drag rk-rail-button"
            aria-label={t`More`}
            aria-current={
              pages.some(
                (page) => page.id !== "marketplace" && page.current && !pins.includes(page.id),
              )
                ? "page"
                : undefined
            }
          >
            <MoreHorizontal size={20} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="start"
            sideOffset={2}
            anchor={() => anchor.current ?? trigger.current}
            className="app-no-drag rk-rail-more-menu"
            aria-label={t`More`}
          >
            {pages.map(({ id, label, icon: Icon, action, current, extra }, index) => (
              <div key={id} role="none">
                {extra && !pages[index - 1]?.extra ? <DropdownMenuSeparator /> : null}
                <div
                  role="none"
                  className="rk-rail-more-row"
                  data-pinned={pins.includes(id) ? "" : undefined}
                >
                  <DropdownMenuItem onClick={action} aria-current={current ? "page" : undefined}>
                    <Icon size={16} strokeWidth={1.6} aria-hidden="true" />
                    <span>{label}</span>
                  </DropdownMenuItem>
                  <DropdownMenuCheckboxItem
                    className="rk-rail-more-pin"
                    closeOnClick={false}
                    checked={pins.includes(id)}
                    onCheckedChange={(checked) => togglePin(id, checked)}
                    aria-label={t`Pin ${label}`}
                    title={pins.includes(id) ? t`Unpin` : t`Pin`}
                  >
                    <Pin size={16} strokeWidth={1.6} aria-hidden="true" />
                  </DropdownMenuCheckboxItem>
                </div>
              </div>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={props.onSettings}>
              <Settings size={16} />
              {t`Settings`}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              render={<a href="https://discord.com/" target="_blank" rel="noopener noreferrer" />}
            >
              Discord
            </DropdownMenuItem>
            <DropdownMenuItem
              render={
                <a href="https://x.com/mycellios" target="_blank" rel="noopener noreferrer" />
              }
            >
              X
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-auto flex flex-col items-center gap-1 pb-2">
        {props.onModels ? <ProviderQuota scope={props.scope} onModels={props.onModels} onUsage={props.onUsage} /> : null}
        {!pins.includes("marketplace") ? (
          <IconTooltip label={t`Marketplace`}>
            <Button
              variant="ghost"
              size="icon"
              className="app-no-drag rk-rail-button"
              aria-label={t`Marketplace`}
              aria-current={props.marketplace ? "page" : undefined}
              onClick={props.onIntegrations}
            >
              <Store size={19} strokeWidth={1.6} />
            </Button>
          </IconTooltip>
        ) : null}
        <HelpMenu onWhatsNew={props.onWhatsNew ?? props.onSettings} />
        <IconTooltip label={t`Settings`}>
          <Button
            variant="ghost"
            size="icon"
            className="app-no-drag rk-rail-button"
            aria-label={t`Settings`}
            onClick={props.onSettings}
          >
            <Settings size={19} strokeWidth={1.6} />
          </Button>
        </IconTooltip>
      </div>
    </nav>
  );
}

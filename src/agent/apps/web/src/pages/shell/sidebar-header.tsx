import { useLingui } from "@lingui/react/macro";
import type { Bot, Space } from "@rakazo/contracts";
import { Badge, Button, Popover, PopoverContent, PopoverTrigger } from "@rakazo/ui-web";
import { ArrowLeft, ArrowRight, Search, FolderPlus, Bell, ChevronsUpDown, PanelLeftClose, PanelLeftOpen, Plus, Settings, Workflow } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { IconTooltip } from "../../components/IconTooltip";
import { desktopBridge } from "../../lib/desktop";
import { spaceLabel } from "../../lib/space-label";
import type { Panel } from "../../lib/right-panel-state";
import { BotCreatePicker } from "./bot-picker";
import { isCreateMenuHotkey } from "./command-palette-hotkey";

/**
 * Whether the create menu is open, opened by Cmd/Ctrl-N. The shell holds it from its first render,
 * so the shortcut is not lost while the sidebar is still waiting for its first data.
 */
export function useCreateMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!isCreateMenuHotkey(event)) return;
      event.preventDefault();
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [open, setOpen] as const;
}

export function SidebarHeader({
  mini = false,
  onSearch,
  onCreateProject,
  createMenuOpen,
  setCreateMenuOpen,
  activityMode,
  toggleActivityMode,
  setBotsSidebarCollapsedPref,
  bots,
  setMobileSidebarOpen,
  setPanel,
  navigate,
  setNewSpaceOpen,
  setCreateBotOpen,
  spaces,
  spaceId,
  onSpace,
  onSpaceSettings,
  history,
  onRoutines,
  onWorkflows,
  onTasks,
  onSchedule,
  onUsage,
  mobileMenu,
}: {
  mini?: boolean;
  onSearch?: () => void;
  onCreateProject?: () => void;
  createMenuOpen: boolean;
  setCreateMenuOpen: (open: boolean) => void;
  activityMode: boolean;
  toggleActivityMode: () => void;
  setBotsSidebarCollapsedPref: (collapsed: boolean) => void;
  bots: Bot[];
  setMobileSidebarOpen: (open: boolean) => void;
  setPanel: (panel: Panel) => void;
  navigate: (path: string) => void;
  setNewSpaceOpen: (open: boolean) => void;
  setCreateBotOpen: (open: boolean) => void;
  spaces: Space[];
  spaceId: string | null;
  onSpace: (spaceId: string, path: string) => void;
  onSpaceSettings: () => void;
  history: { canBack: boolean; canForward: boolean; back: () => void; forward: () => void };
  onRoutines?: () => void;
  onWorkflows?: () => void;
  onTasks?: () => void;
  onSchedule?: () => void;
  onUsage?: () => void;
  mobileMenu?: ReactNode;
}) {
  const { t } = useLingui();
  const hasWindowChrome = Boolean(desktopBridge());
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const toggleLabel = mini ? t`Show bots` : t`Minimize bots`;
  const mobile = mobileMenu != null;
  const currentSpace = spaces.find(space => space.id === spaceId);
  const spaceName = currentSpace ? spaceLabel(currentSpace.name) : null;
  return (
    <div
      data-testid="sidebar-topbar"
      className={mobile
        ? "flex shrink-0 flex-wrap items-center gap-2 px-5 pt-3 pb-1"
        : `${hasWindowChrome ? "app-drag" : ""} rk-sidebar-topbar flex shrink-0 items-center gap-1 ${mini ? "flex-col px-1 py-2" : "px-2"} ${hasWindowChrome && desktopBridge()?.platform !== "win32" ? mini ? "pt-14" : "ps-12" : ""}`}
    >
      {mobile ? <Button variant="floating" size="icon-lg" className="size-12 rounded-full" aria-label={t`Close navigation`} onClick={() => setMobileSidebarOpen(false)}><PanelLeftClose size={22} /></Button> : null}
      {!mini ? <div className={mobile ? "order-last min-w-0 basis-full" : "contents"}>
        {mobile ? <div className="mt-2 flex items-center gap-2"><h1 className="text-3xl font-semibold tracking-tight">Mycellios</h1><Badge variant="outline" className="text-[10px] text-muted-foreground">Beta</Badge></div> : null}
        <Popover open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
        <PopoverTrigger
          className={`app-no-drag flex min-w-0 max-w-full items-center gap-2 rounded-md text-sm font-medium outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring ${mobile ? "min-h-11 text-muted-foreground" : "h-8 px-1.5"}`}
          aria-label={t`Switch workspace`}
          aria-keyshortcuts="Shift+F10"
          onContextMenu={(event) => { event.preventDefault(); setWorkspaceOpen(true); }}
          onKeyDown={(event) => {
            if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
            event.preventDefault();
            setWorkspaceOpen(true);
          }}
        >
          <span className="truncate">{spaceName ?? "Mycellios"}</span><ChevronsUpDown size={mobile ? 15 : 12} className="shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        {workspaceOpen ? <PopoverContent align="start" className={`app-no-drag max-h-[var(--available-height)] w-64 gap-1 overflow-y-auto p-1 ${mobile ? "[&_button]:min-h-11" : ""}`}>
          {spaces.map(space => <Button key={space.id} variant="ghost" className="justify-start" aria-current={space.id === spaceId ? "true" : undefined} onClick={() => { setWorkspaceOpen(false); const first = space.bots[0]; const group = space.groups[0]; onSpace(space.id, first ? `/app/${first.id}` : group ? `/app/g/${group.id}` : "/onboarding"); }}>{spaceLabel(space.name)}</Button>)}
          <div className="my-1 border-t border-border" />
          {spaceId ? <Button variant="ghost" className="justify-start" onClick={() => { setWorkspaceOpen(false); onSpaceSettings(); }}><Settings size={15} />{t`Space settings`}</Button> : null}
          {onRoutines ? <Button variant="ghost" className="justify-start" onClick={() => { setWorkspaceOpen(false); setMobileSidebarOpen(false); onRoutines(); }}><Workflow size={15} />{t`Routines`}</Button> : null}
          {onWorkflows ? <Button variant="ghost" className="justify-start" onClick={() => { setWorkspaceOpen(false); setMobileSidebarOpen(false); onWorkflows(); }}><Workflow size={15} />{t`Workflows`}</Button> : null}
          {onUsage ? <Button variant="ghost" className="justify-start" onClick={() => { setWorkspaceOpen(false); setMobileSidebarOpen(false); onUsage(); }}><Workflow size={15} />{t`Usage`}</Button> : null}
          {onSchedule ? <Button variant="ghost" className="justify-start" onClick={() => { setWorkspaceOpen(false); setMobileSidebarOpen(false); onSchedule(); }}><Workflow size={15} />{t`Schedule`}</Button> : null}
          {onTasks ? <Button variant="ghost" className="justify-start" onClick={() => { setWorkspaceOpen(false); setMobileSidebarOpen(false); onTasks(); }}><Workflow size={15} />{t`Tasks`}</Button> : null}
          <Button variant="ghost" className="justify-start" onClick={() => { setWorkspaceOpen(false); setNewSpaceOpen(true); }}><Plus size={15} />{t`New space`}</Button>
        </PopoverContent> : null}
      </Popover></div> : null}
      {!mini && !mobile ? <Badge variant="outline" className="h-4 px-1.5 text-[10px] text-muted-foreground">Beta</Badge> : null}
      <div className={`relative flex shrink-0 items-center gap-0.5 ${mini ? "flex-col" : "ms-auto"}`}>
        {!mini ? <div className="hidden items-center md:flex">
          <IconTooltip label={t`Back`}><Button variant="ghost" size="icon-sm" className="app-no-drag size-7" aria-label={t`Back`} disabled={!history.canBack} onClick={history.back}><ArrowLeft size={15} /></Button></IconTooltip>
          <IconTooltip label={t`Forward`}><Button variant="ghost" size="icon-sm" className="app-no-drag size-7" aria-label={t`Forward`} disabled={!history.canForward} onClick={history.forward}><ArrowRight size={15} /></Button></IconTooltip>
        </div> : null}
        {onSearch ? (
          <IconTooltip label={t`Search`}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Search`}
              data-testid="sidebar-search-trigger"
              onClick={onSearch}
              className="app-no-drag flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground/75"
            >
              <Search size={15} strokeWidth={1.8} aria-hidden="true" />
            </Button>
          </IconTooltip>
        ) : null}
        {!mobile ? <IconTooltip label={t`Activity`}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t`Activity`}
            aria-pressed={activityMode}
            data-activity-mode={activityMode ? "on" : "off"}
            onClick={toggleActivityMode}
            className={`app-no-drag flex h-7 w-7 items-center justify-center rounded-md md:hidden ${
              activityMode
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground/70 hover:text-foreground/75"
            }`}
          >
            <Bell
              size={15}
              strokeWidth={1.8}
              fill={activityMode ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </Button>
        </IconTooltip> : null}
        <IconTooltip label={toggleLabel}>
          <Button
            variant="ghost"
            size="icon-sm"
            className="app-no-drag hidden h-7 w-7 items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground/75 md:inline-flex"
            aria-label={toggleLabel}
            data-testid={mini ? "restore-bots-sidebar" : "minimize-bots-sidebar"}
            onClick={() => setBotsSidebarCollapsedPref(!mini)}
          >
            {mini ? (
              <PanelLeftOpen size={15} strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={15} strokeWidth={1.8} aria-hidden="true" />
            )}
          </Button>
        </IconTooltip>
        <Popover open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
          <IconTooltip label={t`Create`}>
            <PopoverTrigger
              className={`app-no-drag flex items-center justify-center rounded-full outline-none hover:text-foreground/75 focus-visible:ring-2 focus-visible:ring-ring ${mobile ? "size-12 bg-muted text-foreground" : "size-7 text-muted-foreground/70"}`}
              aria-label={t`Create`}
              data-testid="create-menu-trigger"
            >
              <Plus size={mobile ? 22 : 15} strokeWidth={1.8} aria-hidden="true" />
            </PopoverTrigger>
          </IconTooltip>
          {/* Unmount with the state change so the panel it opens never coexists with the menu. */}
          {createMenuOpen ? (
            <PopoverContent
              align="end"
              className="app-no-drag w-auto gap-0 overflow-hidden p-0 data-closed:animate-none"
            >
              <BotCreatePicker
                bots={bots}
                onCreateBot={() => {
                  setCreateMenuOpen(false);
                  setMobileSidebarOpen(false);
                  setCreateBotOpen(true);
                }}
                onOpenBot={(id) => {
                  setCreateMenuOpen(false);
                  setMobileSidebarOpen(false);
                  navigate(`/app/${id}`);
                }}
                onCreateGroup={() => {
                  setCreateMenuOpen(false);
                  setMobileSidebarOpen(false);
                  setPanel("create-group");
                }}
                onCreateSpace={() => {
                  setCreateMenuOpen(false);
                  setMobileSidebarOpen(false);
                  setNewSpaceOpen(true);
                }}
              />
              {onCreateProject ? <Button variant="ghost" className="w-full justify-start rounded-none" onClick={() => { setCreateMenuOpen(false); onCreateProject(); }}><FolderPlus size={16} />{t`New project`}</Button> : null}
            </PopoverContent>
          ) : null}
        </Popover>
        {mobileMenu}
      </div>
    </div>
  );
}

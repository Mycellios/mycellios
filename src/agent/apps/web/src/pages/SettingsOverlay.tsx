import { useLingui } from "@lingui/react/macro";
import type { Bot, SpaceMemoryConfig } from "@rakazo/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  Input,
  OptionSelect,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Bot as BotIcon,
  Brain,
  ChevronLeft,
  ChevronRight,
  CloudDownload,
  Cpu,
  CreditCard,
  Gauge,
  ListChecks,
  Lock,
  Monitor,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  UserRound,
  Volume2,
  XIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApprovalRulesSettings } from "../components/ApprovalRulesSettings";
import { useDeveloperMode } from "../lib/developer-mode";
import { spaceQueries, useQueryUserId, writeSaved } from "../lib/query";
import { SpaceRpcProvider } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";
import {
  ComputerSettingsPanel,
  GeneralSettingsPanels,
  UsageSettingsPanel,
} from "./AccountSettingsOverlay";
import { BillingSettingsPanel } from "./BillingSettingsPanel";
import { MemorySettingsOverlay } from "./MemorySettingsOverlay";
import { ModelSettingsOverlay } from "./ModelSettingsOverlay";
import { RunLogsSettingsPanel } from "./RunLogsSettingsPanel";
import { SpaceSettingsPanel } from "./SpaceSettingsPanel";
import {
  MicosSettingsPanel,
  MobileSettingsPanel,
  VoiceEntryPanel,
} from "./settings/CompanionPanels";
import { NotificationsPanel } from "./settings/NotificationsPanel";
import { settingsKeywords, settingsMatch } from "./settings/navigation";
import { UpdatesPanel } from "./settings/UpdatesPanel";
import type { SettingsSpace } from "./shell/dialogs";
import type { SettingsSection } from "./shell-overlay";
import { VoiceSettingsOverlay } from "./VoiceSettingsOverlay";

/**
 * Sections whose settings belong to a space; only these show the space picker. Models, voice,
 * and confirmations are the account's, and a space customizes them from its Space section.
 */
const SPACE_SECTIONS: ReadonlySet<SettingsSection> = new Set([
  "space",
  "memory",
  "logs",
  "agents",
  "notifications",
]);

type NavItem = {
  id: SettingsSection;
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  keywords?: string;
};

export function SettingsOverlay({
  bots = [],
  onBotNotificationsChange,
  onOpenMico,
  onWhatsNew,
  onOpenVoice,
  space,
  spaces = [],
  currentSpaceId,
  onSpaceChange,
  onRenameSpace,
  onDeleteSpace,
  email,
  name,
  usage,
  onUsageOpen,
  section: requestedSection,
  onSectionChange,
  onNameSaved,
  timezone,
  onTimezoneChange,
  billingEnabled = false,
  sandboxProvider,
  onSandboxProviderChange,
  messagingEnabled = false,
  onOpenMessaging,
  onOpenSkills,
  memoryConfig,
  onMemoryConfigChange,
  onClose,
  onVoiceStatusMaybeChanged,
}: {
  bots?: Bot[];
  onBotNotificationsChange?: (id: string, enabled: boolean) => Promise<void>;
  onOpenMico?: (id: string) => void;
  onWhatsNew?: () => void;
  onOpenVoice?: () => void;
  /** The space the per-space sections act on; it need not be the selected space. */
  space?: SettingsSpace | null;
  spaces?: { id: string; name: string }[];
  /** The space the app is showing; its memory config comes from the shell. */
  currentSpaceId?: string | null;
  onSpaceChange?: (spaceId: string) => void;
  onRenameSpace?: (spaceId: string, name: string) => Promise<void>;
  onDeleteSpace?: (spaceId: string) => Promise<void>;
  email?: string | null;
  name: string;
  usage?: {
    runs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens?: number | null;
  } | null;
  onUsageOpen: () => void;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onNameSaved?: () => Promise<void>;
  timezone: string | null;
  onTimezoneChange: (timezone: string) => Promise<void>;
  billingEnabled?: boolean;
  sandboxProvider?: string | null;
  onSandboxProviderChange?: (sandboxProvider: string) => void;
  messagingEnabled?: boolean;
  onOpenMessaging?: () => void;
  onOpenSkills?: () => void;
  memoryConfig: SpaceMemoryConfig | null | undefined;
  onMemoryConfigChange: (config: SpaceMemoryConfig | null) => void;
  onClose: () => void;
  onVoiceStatusMaybeChanged?: () => void | Promise<void>;
}) {
  const { t, i18n } = useLingui();
  const [developerMode] = useDeveloperMode();
  const panelRef = useRef<HTMLDivElement>(null);
  const [navElement, setNavElement] = useState<HTMLElement | null>(null);
  const [navOverflow, setNavOverflow] = useState({ previous: false, next: false });
  const usageRef = useRef<HTMLDivElement>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [formState, setFormState] = useState({ busy: false, dirty: false });
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null);
  const [search, setSearch] = useState("");
  const userId = useQueryUserId();
  const [, setKeepComputerRecovery] = useState(false);
  const recoveryHoldTimer = useRef<number | undefined>(undefined);
  const showComputer = true;
  const showUpdates = true;
  // A section that isn't available yet (billing before its flag loads) shows General until it is.
  const section =
    (requestedSection === "logs" && !developerMode) ||
    (requestedSection === "computer" && !showComputer) ||
    (requestedSection === "billing" && !billingEnabled) ||
    (requestedSection === "updates" && !showUpdates)
      ? "general"
      : requestedSection;
  const panelBusy = memoryBusy || voiceBusy || notificationBusy || formState.busy;
  const spaceScoped = SPACE_SECTIONS.has(section);
  const spaceId = spaceScoped ? (space?.id ?? null) : null;
  // The shell only holds the selected space's memory config; another space's loads here.
  const otherSpace = Boolean(spaceId && currentSpaceId && spaceId !== currentSpaceId);
  // Cached per space, so a switch never shows the previous space's config.
  const queryClient = useQueryClient();
  const otherMemoryOptions = spaceQueries(userId, spaceId).memory.providerConfig.queryOptions({
    enabled: section === "memory" && otherSpace,
  });
  const otherMemory = useQuery(otherMemoryOptions);
  const otherBotsOptions = spaceQueries(userId, spaceId).bots.list.queryOptions({
    enabled: otherSpace && (section === "agents" || section === "notifications"),
  });
  const otherBots = useQuery(otherBotsOptions);
  const shownBots = (otherSpace ? (otherBots.data ?? []) : bots).filter(
    (bot) => !spaceId || bot.spaceId === spaceId,
  );
  const botsBlocked = otherSpace && (otherBots.isError || otherBots.data === undefined);
  const botsReadState = otherBots.isError ? (
    <div role="alert" className="space-y-3">
      <p className="text-sm text-destructive">
        {errorText(otherBots.error, t`Could not load Micos.`)}
      </p>
      <Button variant="outline" onClick={() => void otherBots.refetch()}>{t`Retry`}</Button>
    </div>
  ) : (
    <p role="status" className="text-sm text-muted-foreground">{t`Loading…`}</p>
  );
  async function updateNotification(id: string, enabled: boolean) {
    await onBotNotificationsChange?.(id, enabled);
    if (otherSpace)
      await writeSaved(queryClient, otherBotsOptions.queryKey, (current) =>
        (current ?? []).map((bot) => (bot.id === id ? { ...bot, notifyOnFinish: enabled } : bot)),
      );
  }
  const otherMemoryError =
    otherMemory.isError && !otherMemory.isFetching && otherMemory.data === undefined
      ? errorText(otherMemory.error)
      : undefined;
  const otherMemoryConfig = otherMemory.data;
  const setOtherMemoryConfig = (config: SpaceMemoryConfig | null) =>
    void writeSaved(queryClient, otherMemoryOptions.queryKey, () => config);
  const releaseComputerRecovery = useCallback(() => {
    window.clearTimeout(recoveryHoldTimer.current);
    recoveryHoldTimer.current = undefined;
    setKeepComputerRecovery(false);
  }, []);
  const holdComputerRecovery = useCallback(() => {
    setKeepComputerRecovery(true);
    window.clearTimeout(recoveryHoldTimer.current);
    recoveryHoldTimer.current = window.setTimeout(() => {
      recoveryHoldTimer.current = undefined;
      setKeepComputerRecovery(false);
    }, 4000);
  }, []);

  useEffect(() => {
    if (section !== "computer") releaseComputerRecovery();
  }, [section, releaseComputerRecovery]);
  useEffect(() => () => window.clearTimeout(recoveryHoldTimer.current), []);

  useEffect(() => {
    if (section === "usage") {
      onUsageOpen();
      usageRef.current?.focus();
    }
  }, [section, onUsageOpen]);

  const navItems: NavItem[] = [
    { id: "general", label: t`General`, icon: Settings },
    { id: "profile", label: t`Profile and security`, icon: UserRound },
    { id: "agents", label: t`Micos`, icon: BotIcon },
    { id: "models", label: t`Models`, icon: Cpu },
    { id: "notifications", label: t`Notifications`, icon: Bell },
    { id: "voice", label: t`Voice`, icon: Volume2 },
    { id: "confirmations", label: t`Approvals`, icon: ShieldCheck },
    { id: "space", label: t`Space`, icon: Lock },
    { id: "memory", label: t`Memory`, icon: Brain },
    { id: "usage", label: t`Usage`, icon: Gauge },
    ...(developerMode ? [{ id: "logs" as const, label: t`Logs`, icon: ListChecks }] : []),
    ...(showComputer ? [{ id: "computer" as const, label: t`Computer`, icon: Monitor }] : []),
    ...(billingEnabled ? [{ id: "billing" as const, label: t`Billing`, icon: CreditCard }] : []),
    { id: "mobile", label: t`Mobile connection`, icon: Smartphone },
    ...(showUpdates ? [{ id: "updates" as const, label: t`Updates`, icon: CloudDownload }] : []),
  ];
  const visibleItems = navItems.filter((item) =>
    settingsMatch({ ...item, keywords: settingsKeywords[item.id] }, search),
  );

  useEffect(() => {
    const nav = navElement;
    if (!nav) return;
    const measure = () => {
      const offset = Math.abs(nav.scrollLeft);
      setNavOverflow({
        previous: offset > 1,
        next: nav.scrollWidth - nav.clientWidth - offset > 1,
      });
    };
    const revealSection = () => {
      if (nav.scrollWidth > nav.clientWidth) {
        nav.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({
          block: "nearest",
          inline: "nearest",
        });
      }
      measure();
    };
    revealSection();
    nav.addEventListener("scroll", measure);
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(revealSection);
    observer?.observe(nav);
    return () => {
      nav.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [navElement, section, showComputer, billingEnabled, showUpdates, i18n.locale, search]);

  function scrollSections(direction: number) {
    const nav = navElement;
    if (!nav) return;
    const rtl = getComputedStyle(nav).direction === "rtl";
    nav.scrollBy({ left: nav.clientWidth * 0.75 * direction * (rtl ? -1 : 1), behavior: "smooth" });
  }

  const sectionTitle =
    navItems.find((item) => item.id === section)?.label ??
    (section === "general" ? t`General` : t`Settings`);

  const closeLabel =
    section === "models"
      ? t`Close model settings`
      : section === "memory"
        ? t`Close memory settings`
        : section === "voice"
          ? t`Close voice settings`
          : t`Close user settings`;

  async function refreshVoiceStatus() {
    await onVoiceStatusMaybeChanged?.();
  }

  // Leaving is immediate, so the URL updates in the same tick; voice readiness refreshes behind it.
  function leaveSettings(next: () => void) {
    if (panelBusy) return;
    if (formState.dirty) {
      setLeaveAction(() => next);
      return;
    }
    void refreshVoiceStatus();
    next();
  }

  function requestClose() {
    leaveSettings(onClose);
  }

  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (open) return;
        if (panelBusy || formState.dirty) {
          details.cancel();
          if (!panelBusy) requestClose();
          return;
        }
        requestClose();
      }}
    >
      <DialogContent
        ref={panelRef}
        data-testid="user-settings"
        data-settings-section={section}
        showCloseButton={false}
        initialFocus={() =>
          section === "usage" ? (usageRef.current ?? panelRef.current) : panelRef.current
        }
        className="flex h-[min(760px,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] w-[calc(100dvw-2rem)] max-w-[1080px] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-h-[calc(100dvh-5rem)] sm:max-w-[1080px]"
      >
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="flex min-h-0 shrink-0 flex-col border-b border-border md:w-[232px] md:border-b-0 md:border-e">
            <div className="space-y-3 px-4 pt-4 pb-2">
              <p className="hidden text-sm font-semibold md:block">{t`Settings`}</p>
              <div className="relative">
                <Search className="pointer-events-none absolute start-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  data-testid="settings-search"
                  aria-label={t`Search settings`}
                  placeholder={t`Search settings…`}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && search) {
                      event.stopPropagation();
                      setSearch("");
                    }
                    if (event.key === "Enter" && visibleItems.length === 1) {
                      event.preventDefault();
                      leaveSettings(() => onSectionChange(visibleItems[0]!.id));
                    }
                  }}
                  className="h-8 rounded-lg bg-muted/50 ps-8 pe-8 text-xs"
                />
                {search ? (
                  <button
                    type="button"
                    className="absolute end-1 top-0.5 grid size-7 place-items-center rounded-md focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={t`Clear settings search`}
                    onClick={() => setSearch("")}
                  >
                    <XIcon size={13} />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="flex min-h-0 items-center gap-1 px-3 md:flex-1 md:px-0">
              {/* Reserve arrow space so showing controls does not change the overflow measurement. */}
              <Button
                variant="ghost"
                size="icon-sm"
                className={`shrink-0 md:hidden ${navOverflow.previous || navOverflow.next ? "" : "invisible"}`}
                aria-label={t`Previous settings sections`}
                disabled={!navOverflow.previous || panelBusy}
                onClick={() => scrollSections(-1)}
              >
                <ChevronLeft className="rtl:rotate-180" />
              </Button>
              <nav
                ref={setNavElement}
                data-testid="settings-nav"
                aria-label={t`Settings`}
                className="flex min-h-0 min-w-0 flex-1 flex-row gap-1 overflow-x-auto py-2 md:h-full md:w-full md:flex-col md:overflow-y-auto md:px-3"
              >
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const active = item.id === section;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-testid={`settings-nav-${item.id}`}
                      aria-current={active ? "page" : undefined}
                      disabled={panelBusy}
                      onClick={() => leaveSettings(() => onSectionChange(item.id))}
                      className={`flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[13.5px] transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                        active
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                      <span className="whitespace-nowrap">{item.label}</span>
                    </button>
                  );
                })}
                {!visibleItems.length ? (
                  <p
                    role="status"
                    className="px-2 py-3 text-sm text-muted-foreground"
                  >{t`No settings found.`}</p>
                ) : null}
              </nav>
              <Button
                variant="ghost"
                size="icon-sm"
                className={`shrink-0 md:hidden ${navOverflow.previous || navOverflow.next ? "" : "invisible"}`}
                aria-label={t`Next settings sections`}
                disabled={!navOverflow.next || panelBusy}
                onClick={() => scrollSections(1)}
              >
                <ChevronRight className="rtl:rotate-180" />
              </Button>
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              data-testid="settings-header"
              className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 pb-5 pt-6 sm:px-8 sm:pt-7"
            >
              <div className="flex min-w-0 flex-col gap-2">
                <DialogTitle className="text-heading2 font-medium text-foreground">
                  {sectionTitle}
                </DialogTitle>
                {!spaceScoped ? null : space && spaces.length > 1 && onSpaceChange ? (
                  <OptionSelect
                    className="w-56 max-w-full"
                    data-testid="settings-space"
                    aria-label={t`Space`}
                    options={spaces.map((option) => ({ value: option.id, label: option.name }))}
                    value={space.id}
                    disabled={panelBusy}
                    onValueChange={(next) => {
                      if (next !== space.id) leaveSettings(() => onSpaceChange(next));
                    }}
                  />
                ) : space && spaces.length > 1 ? (
                  <p
                    data-testid="settings-space"
                    className="break-words text-sm text-muted-foreground"
                  >
                    {space.name}
                  </p>
                ) : null}
              </div>
              <DialogClose
                aria-label={closeLabel}
                disabled={panelBusy}
                render={<Button variant="ghost" size="icon-sm" />}
              >
                <XIcon />
              </DialogClose>
            </div>

            <SpaceRpcProvider spaceId={spaceId}>
              <div
                key={spaceId ?? "selected"}
                data-testid="settings-scroll"
                className={`min-h-0 flex-1 ${
                  section === "memory"
                    ? "flex flex-col overflow-hidden"
                    : "rk-scroll overflow-y-auto overscroll-contain px-6 pb-6 pt-6 sm:px-8 sm:pb-8"
                }`}
              >
                {section === "general" || section === "profile" ? (
                  <GeneralSettingsPanels
                    key={section}
                    mode={section === "profile" ? "profile" : "general"}
                    onFormStateChange={setFormState}
                    email={email}
                    name={name}
                    onNameSaved={onNameSaved}
                    timezone={timezone}
                    onTimezoneChange={onTimezoneChange}
                    messagingEnabled={messagingEnabled}
                    onOpenSkills={onOpenSkills ? () => leaveSettings(onOpenSkills) : undefined}
                    onOpenMessaging={
                      onOpenMessaging ? () => leaveSettings(onOpenMessaging) : undefined
                    }
                  />
                ) : null}
                {section === "agents" && botsBlocked ? (
                  botsReadState
                ) : section === "agents" ? (
                  <MicosSettingsPanel
                    bots={shownBots}
                    onOpen={onOpenMico ? (id) => leaveSettings(() => onOpenMico(id)) : undefined}
                    onSkills={onOpenSkills ? () => leaveSettings(onOpenSkills) : undefined}
                  />
                ) : null}
                {section === "notifications" && botsBlocked ? (
                  botsReadState
                ) : section === "notifications" ? (
                  <NotificationsPanel
                    key={userId ?? "anonymous"}
                    scope={userId ?? ""}
                    bots={shownBots}
                    onUpdate={onBotNotificationsChange ? updateNotification : undefined}
                    onBusyChange={setNotificationBusy}
                  />
                ) : null}
                {section === "mobile" ? <MobileSettingsPanel /> : null}
                {section === "space" && space ? (
                  <SpaceSettingsPanel
                    key={space.id}
                    space={space}
                    onRename={(name) => onRenameSpace?.(space.id, name) ?? Promise.resolve()}
                    onDelete={() => onDeleteSpace?.(space.id) ?? Promise.resolve()}
                    onClose={requestClose}
                    onBusyChange={setVoiceBusy}
                  />
                ) : null}
                {section === "confirmations" ? <ApprovalRulesSettings scope="account" /> : null}
                {section === "usage" ? (
                  <UsageSettingsPanel usage={usage} panelRef={usageRef} />
                ) : null}
                {section === "logs" ? <RunLogsSettingsPanel /> : null}
                {section === "computer" && showComputer ? (
                  <ComputerSettingsPanel
                    sandboxProvider={sandboxProvider}
                    onSandboxProviderChange={(next) => {
                      onSandboxProviderChange?.(next);
                      holdComputerRecovery();
                    }}
                    onRecoveryDismissed={releaseComputerRecovery}
                  />
                ) : null}
                {section === "billing" && billingEnabled ? <BillingSettingsPanel /> : null}
                {section === "updates" && showUpdates ? (
                  <UpdatesPanel
                    onWhatsNew={onWhatsNew ? () => leaveSettings(onWhatsNew) : undefined}
                    onClose={requestClose}
                  />
                ) : null}
                {section === "models" ? (
                  <ModelSettingsOverlay
                    embedded
                    scope="account"
                    onClose={requestClose}
                    onFormStateChange={setFormState}
                    onRequestLeave={leaveSettings}
                  />
                ) : null}
                {section === "memory" && otherSpace && otherMemoryError ? (
                  <div className="px-6 py-6 sm:px-8">
                    <p className="mb-4 text-sm text-destructive">{otherMemoryError}</p>
                    <Button variant="outline" onClick={() => void otherMemory.refetch()}>
                      {t`Retry`}
                    </Button>
                  </div>
                ) : section === "memory" ? (
                  <MemorySettingsOverlay
                    embedded
                    onClose={requestClose}
                    config={otherSpace ? otherMemoryConfig : memoryConfig}
                    onConfigChange={otherSpace ? setOtherMemoryConfig : onMemoryConfigChange}
                    onBusyChange={setMemoryBusy}
                    onFormStateChange={setFormState}
                  />
                ) : null}
                {section === "voice" ? (
                  <>
                    {onOpenVoice ? <VoiceEntryPanel onOpen={() => leaveSettings(onOpenVoice)} /> : null}
                    <VoiceSettingsOverlay
                      onFormStateChange={setFormState}
                      embedded
                      scope="account"
                      onClose={requestClose}
                      onBusyChange={setVoiceBusy}
                    />
                  </>
                ) : null}
              </div>
            </SpaceRpcProvider>
          </div>
        </div>
        <AlertDialog
          open={leaveAction !== null}
          onOpenChange={(open) => {
            if (!open) setLeaveAction(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t`Discard unsaved changes?`}</AlertDialogTitle>
              <AlertDialogDescription>{t`Your changes have not been saved. Stay here to save them, or discard them to continue.`}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t`Keep editing`}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  const next = leaveAction;
                  setLeaveAction(null);
                  setFormState({ busy: false, dirty: false });
                  next?.();
                }}
              >{t`Discard changes`}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

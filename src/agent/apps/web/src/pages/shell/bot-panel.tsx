import { Trans, useLingui } from "@lingui/react/macro";
import type {
  AgentSkillCatalogEntry,
  Bot,
  ComputerMode,
  ModelCatalogEntry,
  ThinkingLevel,
} from "@rakazo/contracts";
import {
  BOT_COMPUTER_MODES,
  BOT_DESCRIPTION_MAX_LENGTH,
  BOT_NAME_MAX_LENGTH,
  BOT_TITLE_MAX_LENGTH,
  BUILTIN_TOOL_NAMES,
  isBuiltinToolName,
} from "@rakazo/contracts";
import {
  chatModelChoices,
  connectedModelChoices,
  credentialForModel,
  modelOptionKey,
  parseModelOptionKey,
  resolveSelectableModelId,
} from "@rakazo/core";
import {
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  Switch,
  Textarea,
  Toggle,
} from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, CalendarClock, ChevronRight, Download, FileText, Folder, Gauge, Monitor, Puzzle, Settings, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import type { ReactNode } from "react";
import { Suspense, useEffect, useId, useRef, useState } from "react";
import { ErrorBoundary, SectionLoadFailed } from "../../components/ErrorBoundary";
import { InstructionSettings } from "../../components/InstructionSettings";
import { botProfilePatch } from "../../lib/bot-profile-patch";
import { generalChatModel, selectableCatalogEntry, thinkingLevelLabel } from "../../lib/model-catalog";
import { lazyComponent } from "../../lib/preload-recovery";
import { useSpaceQueries } from "../../lib/query";
import { errorText } from "../../lib/user-error";
import { AgentImportUndo } from "./agent-import-undo";
import { AvatarStudioPopover } from "./avatar-studio-popover";
import { BotCredentialsSection } from "./bot-credentials";
import { ChatModelPicker } from "./chat-model-picker";
import { isMycelliosBaseUrl, MAX_ENABLED_MODEL_IDS } from "@rakazo/contracts";
import { useCompatibleRoleCatalog } from "../model-settings/use-compatible-role-catalog";
import { useSpaceRpc } from "../../lib/space-rpc";

const ScratchpadSection = lazyComponent(() =>
  import("../ScratchpadSection").then((module) => module.ScratchpadSection),
);

const KnowledgeSection = lazyComponent(() =>
  import("../KnowledgeSection").then((module) => module.KnowledgeSection),
);

const rowLabelClass = "text-sm text-foreground";
type BotSettingsPage = "instructions" | "memory" | "skills" | "computer" | "permissions" | "advanced";

/** The advanced fields one Save sends, in the order their saved snapshot keeps them. */
function advancedValues(bot: Bot) {
  return [
    bot.modelProvider && bot.modelId ? modelOptionKey(bot.modelProvider, bot.modelId) : "",
    bot.thinkingLevel ?? "",
    bot.computerMode,
    bot.memoryScope,
    bot.autoSpeak,
    bot.voiceId ?? "",
  ] as const;
}

export function ComputerModePicker({
  value,
  onChange,
  desktopAvailable = true,
}: {
  value: ComputerMode;
  onChange: (value: ComputerMode) => void;
  desktopAvailable?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {BOT_COMPUTER_MODES.map((mode) => (
        <Toggle
          key={mode}
          variant="outline"
          pressed={value === mode}
          disabled={mode === "dedicated" && !desktopAvailable}
          onPressedChange={(pressed) => {
            if (pressed) onChange(mode);
          }}
          className="capitalize aria-pressed:border-foreground/40 aria-pressed:text-foreground"
        >
          {mode === "team" ? <Trans>Cloud/Team</Trans> : <Trans>This PC</Trans>}
        </Toggle>
      ))}
    </div>
  );
}

export function BotSettings({
  bot,
  memoryProviderConfigured,
  onSave,
  onExport,
  onClear,
  onUndoImport,
  focusModel = 0,
  onOpenConnections,
  onOpenFiles,
  onOpenRoutines,
  onOpenUsage,
  onUseThisComputer,
}: {
  bot: Bot;
  focusModel?: number;
  onOpenConnections?: () => void;
  onOpenFiles?: () => void;
  onOpenRoutines?: () => void;
  onOpenUsage?: () => void;
  /** Present only on Desktop: bind this Mico to the running PC and repair a Docker fallback. */
  onUseThisComputer?: () => Promise<void>;
  /** Unused: the skill sections read and save the shared cached skill list. */
  onSkillsChange?: (skills: AgentSkillCatalogEntry[]) => void;
  memoryProviderConfigured: boolean;
  onSave: (patch: {
    agentEngine?: Bot["agentEngine"];
    name?: string;
    title?: string;
    description?: string;
    instructions?: string;
    color?: string;
    notifyOnFinish?: boolean;
    computerMode?: ComputerMode;
    memoryScope?: "isolated" | "shared" | null;
    autoSpeak?: boolean;
    fleetManagement?: boolean;
    crossSpaceCommunication?: boolean;
    voiceId?: string | null;
    modelProvider?: string | null;
    modelId?: string | null;
    thinkingLevel?: ThinkingLevel | null;
    disabledBuiltinTools?: string[];
  }) => Promise<void>;
  onExport: () => Promise<void>;
  onClear: () => void;
  /** Shown for bots that came from an agent import. */
  onUndoImport?: () => void;
}) {
  const { t } = useLingui();
  const ids = useId();
  const [page, setPage] = useState<BotSettingsPage | null>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousPage = useRef<BotSettingsPage | null>(null);
  const requestedModel = useRef(0);
  const modelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusModel && requestedModel.current !== focusModel) {
      if (page) {
        setPage(null);
        return;
      }
      requestedModel.current = focusModel;
      modelRef.current?.scrollIntoView?.({ block: "nearest" });
      modelRef.current?.querySelector<HTMLElement>('[id$="-model"]')?.focus();
    } else if (page) {
      pageHeadingRef.current?.focus();
    } else if (previousPage.current) {
      overviewRef.current?.querySelector<HTMLElement>(`[data-settings-page="${previousPage.current}"]`)?.focus();
    }
    previousPage.current = page;
  }, [focusModel, page]);
  const [name, setName] = useState(bot.name);
  const [title, setTitle] = useState(bot.title);
  const savedNameRef = useRef(bot.name);
  const savedTitleRef = useRef(bot.title);
  const [description, setDescription] = useState(bot.description);
  // A roster refresh can skip replacing bots while a reorder is in flight, so
  // this prop keeps the description from when the panel opened. Later saves
  // compare against the description last saved here; otherwise a model or
  // voice change treats that stale text as an edit and overwrites instructions.
  const savedDescriptionRef = useRef(bot.description ?? "");
  const [color, setColor] = useState(bot.color);
  const [notifyOnFinish, setNotifyOnFinish] = useState(bot.notifyOnFinish ?? true);
  const acceptedAutomatic = useRef({
    color: bot.color,
    notifyOnFinish: bot.notifyOnFinish ?? true,
  });
  const automaticRevision = useRef({ color: 0, notifyOnFinish: 0 });
  const [computerMode, setComputerMode] = useState(bot.computerMode);
  const [memoryScope, setMemoryScope] = useState(bot.memoryScope);
  const [autoSpeak, setAutoSpeak] = useState(bot.autoSpeak);
  const [crossSpaceCommunication, setCrossSpaceCommunication] = useState(
    bot.crossSpaceCommunication ?? false,
  );
  useEffect(
    () => setCrossSpaceCommunication(bot.crossSpaceCommunication ?? false),
    [bot.crossSpaceCommunication],
  );
  const [fleetManagement, setFleetManagement] = useState(bot.fleetManagement);
  useEffect(() => setFleetManagement(bot.fleetManagement), [bot.fleetManagement]);
  const [voiceId, setVoiceId] = useState(bot.voiceId ?? "");
  const [modelKey, setModelKey] = useState(
    bot.modelProvider && bot.modelId ? modelOptionKey(bot.modelProvider, bot.modelId) : "",
  );
  const [thinkingLevel, setThinkingLevel] = useState(bot.thinkingLevel ?? "");
  const [disabledBuiltinTools, setDisabledBuiltinTools] = useState<string[]>(
    bot.disabledBuiltinTools ?? [],
  );
  // The list on screen is updated before the save returns. This stays on the
  // last list the server accepted so a rejection can undo that preview.
  const persistedDisabledToolsRef = useRef(disabledBuiltinTools);
  const serverDisabledToolsRef = useRef(disabledBuiltinTools);
  const pendingSavesRef = useRef(0);
  useEffect(() => {
    const next = bot.disabledBuiltinTools ?? [];
    if (serverDisabledToolsRef.current === next) return;
    serverDisabledToolsRef.current = next;
    persistedDisabledToolsRef.current = next;
    if (pendingSavesRef.current === 0) setDisabledBuiltinTools(next);
  }, [bot.disabledBuiltinTools]);
  // Shared with the model and voice settings, so a revisit paints at once and refreshes behind.
  const queries = useSpaceQueries();
  const refresh = { refetchOnMount: "always" } as const;
  const voices = useQuery({ ...queries.voice.voices.queryOptions({ input: {} }), ...refresh }).data;
  const credentialsQuery = useQuery({ ...queries.models.credentials.queryOptions(), ...refresh });
  const catalogQuery = useQuery({ ...queries.models.list.queryOptions(), ...refresh });
  const meQuery = useQuery({ ...queries.me.queryOptions(), ...refresh });
  const credentials = credentialsQuery.data ?? NO_CREDENTIALS;
  const catalog = catalogQuery.data ?? NO_CATALOG;
  const me = meQuery.data ?? null;
  const modelRpc = useSpaceRpc();
  const networkModels = useCompatibleRoleCatalog(credentials, me?.userId ?? "", me?.spaceId ?? "", Boolean(me), true);
  // A failed catalog load must not clear an existing thinkingLevel override on save.
  const modelMetaReady =
    credentialsQuery.data !== undefined &&
    catalogQuery.data !== undefined &&
    meQuery.data !== undefined;
  const [saving, setSaving] = useState(false);
  const [savedAdvanced, setSavedAdvanced] = useState(() => JSON.stringify(advancedValues(bot)));
  const advancedSnapshot = JSON.stringify([
    modelKey,
    thinkingLevel,
    computerMode,
    memoryScope,
    autoSpeak,
    voiceId,
  ]);
  const dirty =
    name.trim() !== savedNameRef.current.trim() ||
    title.trim() !== savedTitleRef.current.trim() ||
    advancedSnapshot !== savedAdvanced ||
    description.trim() !== savedDescriptionRef.current;
  const [error, setError] = useState<string | null>(null);
  const [computerBusy, setComputerBusy] = useState(false);
  const saveQueueRef = useRef(Promise.resolve());
  const executeSaveRef = useRef<
    (
      patchOverrides?: {
        name?: string;
        title?: string;
        description?: string;
        color?: string;
        notifyOnFinish?: boolean;
        fleetManagement?: boolean;
        crossSpaceCommunication?: boolean;
        disabledBuiltinTools?: string[];
        baseDisabledBuiltinTools?: string[];
      },
      revisions?: { color: number; notifyOnFinish: number },
    ) => Promise<void>
  >(async () => undefined);
  // The panel can open on a cached bot. When a newer copy arrives, every field not edited since
  // follows it, so a later save does not send the cached values back over it. A copy that is not
  // newer (a roster read from before a save) is ignored.
  const shownBotRef = useRef(bot);
  useEffect(() => {
    if (bot.updatedAt <= shownBotRef.current.updatedAt) return;
    shownBotRef.current = bot;
    if (name.trim() === savedNameRef.current.trim()) setName(bot.name);
    savedNameRef.current = bot.name;
    if (title.trim() === savedTitleRef.current.trim()) setTitle(bot.title);
    savedTitleRef.current = bot.title;
    if (description.trim() === savedDescriptionRef.current) setDescription(bot.description);
    savedDescriptionRef.current = bot.description ?? "";
    const accepted = acceptedAutomatic.current;
    const nextNotify = bot.notifyOnFinish ?? true;
    if (color === accepted.color) setColor(bot.color);
    if (notifyOnFinish === accepted.notifyOnFinish) setNotifyOnFinish(nextNotify);
    acceptedAutomatic.current = { color: bot.color, notifyOnFinish: nextNotify };
    const saved = JSON.parse(savedAdvanced) as unknown[];
    const next = advancedValues(bot);
    if (modelKey === saved[0]) setModelKey(next[0]);
    if (thinkingLevel === saved[1]) setThinkingLevel(next[1]);
    if (computerMode === saved[2]) setComputerMode(next[2]);
    if (memoryScope === saved[3]) setMemoryScope(next[3]);
    if (autoSpeak === saved[4]) setAutoSpeak(next[4]);
    if (voiceId === saved[5]) setVoiceId(next[5]);
    setSavedAdvanced(JSON.stringify(next));
  }, [bot]);

  const connectedOptions = connectedModelChoices(networkModels.credentials, catalog)
    .sort((left, right) => Number(right.providerLabel === "Mycellios") - Number(left.providerLabel === "Mycellios"));
  const storedModel = modelKey ? parseModelOptionKey(modelKey) : null;
  const selectedModel = storedModel
    ? {
        provider: storedModel.provider,
        modelId: resolveSelectableModelId(catalog, storedModel.provider, storedModel.modelId),
      }
    : null;
  const selectedModelKey = selectedModel
    ? modelOptionKey(selectedModel.provider, selectedModel.modelId)
    : "";

  const general = generalChatModel(me, catalog);
  const inheritLabel = t`Use general model`;
  const modelChoices = chatModelChoices(
    connectedOptions,
    selectedModelKey,
    general ? `${inheritLabel} · ${general.label}` : inheritLabel,
    general?.entry?.images,
  );

  const effectiveProvider = selectedModel?.provider ?? general?.provider ?? null;
  const effectiveModelId = selectedModel?.modelId ?? general?.modelId ?? null;
  const effectiveEntry = effectiveProvider && effectiveModelId
    ? selectableCatalogEntry(catalog, effectiveProvider, effectiveModelId)
    : undefined;
  const effectiveCredential = credentialForModel(credentials, effectiveProvider, effectiveModelId);
  const thinkingOptions = (
    effectiveCredential?.thinkingLevels ??
    effectiveEntry?.thinkingLevels ??
    []
  ).filter((level) => level !== "off");
  const defaultThinkingLevel = effectiveCredential?.thinkingLevel ?? "medium";

  async function executeSave(
    patchOverrides?: {
      name?: string;
      title?: string;
      description?: string;
      color?: string;
      notifyOnFinish?: boolean;
      fleetManagement?: boolean;
      crossSpaceCommunication?: boolean;
      disabledBuiltinTools?: string[];
      baseDisabledBuiltinTools?: string[];
    },
    revisions?: { color: number; notifyOnFinish: number },
  ) {
    try {
      setSaving(true);
      setError(null);
      if (patchOverrides?.crossSpaceCommunication !== undefined) {
        await onSave({ crossSpaceCommunication: patchOverrides.crossSpaceCommunication });
        return;
      }
      if (patchOverrides?.fleetManagement !== undefined) {
        await onSave({ fleetManagement: patchOverrides.fleetManagement });
        return;
      }
      const selected = selectedModel;
      // A per-Mico choice enables only that model on the member's existing network
      // connection. It never promotes it to the account's main model.
      if (selected && (selected.provider !== bot.modelProvider || selected.modelId !== bot.modelId)) {
        const owned = credentials.find(entry => entry.provider === selected.provider && isMycelliosBaseUrl(entry.baseUrl));
        if (owned) {
          const enabled = [...new Set([owned.modelId ?? "", ...(owned.enabledModelIds ?? [])])].filter(Boolean);
          if (!enabled.includes(selected.modelId)) {
            if (enabled.length >= MAX_ENABLED_MODEL_IDS) throw new Error(t`This connection has reached its enabled model limit.`);
            await modelRpc.models.connect({ provider: owned.provider, credentialId: owned.id,
              baseUrl: owned.baseUrl, modelId: owned.modelId || selected.modelId,
              enabledModelIds: [...enabled, selected.modelId], makeDefault: false });
          }
        }
      }
      const nextName = (patchOverrides?.name !== undefined ? patchOverrides.name : name).trim();
      const nextTitle = (patchOverrides?.title !== undefined ? patchOverrides.title : title).trim();
      const nextDescription = (
        patchOverrides?.description !== undefined ? patchOverrides.description : description
      ).trim();
      const nextColor = patchOverrides?.color !== undefined ? patchOverrides.color : color;
      const nextNotify =
        patchOverrides?.notifyOnFinish !== undefined
          ? patchOverrides.notifyOnFinish
          : notifyOnFinish;

      if (nextName) setName(nextName);
      setTitle(nextTitle);
      setDescription(nextDescription);
      const patch = {
        ...(nextName && nextName !== savedNameRef.current.trim() ? { name: nextName } : {}),
        ...(nextTitle !== savedTitleRef.current.trim() ? { title: nextTitle } : {}),
        // Keep untouched profile fields off the wire.
        ...botProfilePatch(savedDescriptionRef.current, nextDescription),
        // Unchanged color stays off the wire so a legacy named value cannot fail a name save.
        ...(nextColor !== acceptedAutomatic.current.color ? { color: nextColor } : {}),
        notifyOnFinish: nextNotify,
        computerMode,
        memoryScope,
        autoSpeak,
        voiceId: voiceId || null,
        ...((selected?.provider ?? null) !== (bot.modelProvider ?? null) || (selected?.modelId ?? null) !== (bot.modelId ?? null) ? {
          agentEngine: "pi" as const,
          modelProvider: selected?.provider ?? null,
          modelId: selected?.modelId ?? null,
        } : {}),
        ...(modelMetaReady &&
        (thinkingOptions.length > 0 ||
          (selected?.provider ?? null) !== bot.modelProvider ||
          (selected?.modelId ?? null) !== bot.modelId)
          ? {
              thinkingLevel: thinkingOptions.length
                ? ((thinkingLevel || null) as ThinkingLevel | null)
                : null,
            }
          : {}),
      };
      const requestedTools = patchOverrides?.disabledBuiltinTools;
      const baseTools = patchOverrides?.baseDisabledBuiltinTools ?? [];
      // Preserve this edit's additions/removals against any refreshed server list.
      // Retry if a refresh arrives while the request is in flight.
      for (;;) {
        const serverTools = serverDisabledToolsRef.current;
        const nextTools =
          requestedTools === undefined
            ? undefined
            : [
                ...persistedDisabledToolsRef.current.filter(
                  (name) => !baseTools.includes(name) || requestedTools.includes(name),
                ),
                ...requestedTools.filter(
                  (name) =>
                    !baseTools.includes(name) && !persistedDisabledToolsRef.current.includes(name),
                ),
              ];
        // Unrelated saves omit the list, preserving changes from other sessions.
        await onSave({
          ...patch,
          ...(nextTools !== undefined ? { disabledBuiltinTools: nextTools } : {}),
        });
        if (nextTools === undefined) break;
        if (
          serverTools !== serverDisabledToolsRef.current &&
          !sameStringList(nextTools, serverDisabledToolsRef.current)
        )
          continue;
        persistedDisabledToolsRef.current = nextTools;
        break;
      }
      acceptedAutomatic.current = { color: nextColor, notifyOnFinish: nextNotify };
      if (nextName) savedNameRef.current = nextName;
      savedTitleRef.current = nextTitle;
      savedDescriptionRef.current = nextDescription;
      setSavedAdvanced(
        JSON.stringify([modelKey, thinkingLevel, computerMode, memoryScope, autoSpeak, voiceId]),
      );
    } catch (err) {
      if (
        patchOverrides?.color !== undefined &&
        revisions?.color === automaticRevision.current.color
      )
        setColor(acceptedAutomatic.current.color);
      if (
        patchOverrides?.notifyOnFinish !== undefined &&
        revisions?.notifyOnFinish === automaticRevision.current.notifyOnFinish
      )
        setNotifyOnFinish(acceptedAutomatic.current.notifyOnFinish);
      if (patchOverrides?.crossSpaceCommunication !== undefined)
        setCrossSpaceCommunication(!patchOverrides.crossSpaceCommunication);
      if (patchOverrides?.fleetManagement !== undefined)
        setFleetManagement(!patchOverrides.fleetManagement);
      setError(errorText(err, t`Could not save`));
    } finally {
      pendingSavesRef.current -= 1;
      if (pendingSavesRef.current === 0) {
        setDisabledBuiltinTools([...persistedDisabledToolsRef.current]);
      }
      setSaving(pendingSavesRef.current > 0);
    }
  }
  executeSaveRef.current = executeSave;

  async function switchToThisComputer() {
    if (!onUseThisComputer || computerBusy) return;
    setComputerBusy(true);
    setError(null);
    try {
      await onUseThisComputer();
      setComputerMode("dedicated");
    } catch (err) {
      setError(errorText(err, t`Could not switch to this PC`));
    } finally {
      setComputerBusy(false);
    }
  }

  function disableBuiltinTool(raw: string) {
    const name = raw.trim();
    if (!name) return;
    if (!isBuiltinToolName(name)) return;
    setError(null);
    if (disabledBuiltinTools.includes(name)) return;
    const next = [...disabledBuiltinTools, name];
    setDisabledBuiltinTools(next);
    void enqueueSave({ disabledBuiltinTools: next });
  }

  function enqueueSave(patchOverrides?: {
    name?: string;
    title?: string;
    description?: string;
    color?: string;
    notifyOnFinish?: boolean;
    fleetManagement?: boolean;
    crossSpaceCommunication?: boolean;
    disabledBuiltinTools?: string[];
  }) {
    // Serialize full-object auto-saves so an older in-flight request cannot
    // finish after a newer one and clobber fields. Always call through a ref so
    // queued work reads the latest field values, not a stale render closure.
    pendingSavesRef.current += 1;
    if (patchOverrides?.color !== undefined) automaticRevision.current.color += 1;
    if (patchOverrides?.notifyOnFinish !== undefined) automaticRevision.current.notifyOnFinish += 1;
    const revisions = { ...automaticRevision.current };
    const queuedPatch =
      patchOverrides?.disabledBuiltinTools === undefined
        ? patchOverrides
        : {
            ...patchOverrides,
            baseDisabledBuiltinTools: [...persistedDisabledToolsRef.current],
          };
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => executeSaveRef.current(queuedPatch, revisions));
    return saveQueueRef.current;
  }


  const pageTitles = {
    instructions: t`Instructions`,
    memory: t`Memory`,
    skills: t`Skills`,
    computer: t`Computer`,
    permissions: t`Permissions`,
    advanced: t`Advanced`,
  };
  const computerLabel = computerMode === "team" ? t`Cloud/Team` : t`This PC`;

  return (
    <div data-testid="bot-settings">
      <div ref={overviewRef} hidden={page !== null}>
        <div
          data-testid="bot-profile-header"
          className="flex flex-col items-center pb-6 pt-2 text-center"
        >
          <div className="flex justify-center pb-4">
            <AvatarStudioPopover
              value={color}
              identity={bot.id}
              status={bot.status}
              size={76}
              onChange={(newColor) => {
                setColor(newColor);
                void enqueueSave({ color: newColor });
              }}
            />
          </div>
          <InlineProfileField
            label={t`Name`}
            editLabel={t`Edit name`}
            value={name}
            maxLength={BOT_NAME_MAX_LENGTH}
            className="text-xl font-semibold"
            onCommit={(value) => {
              if (!value.trim()) return;
              setName(value.trim());
              void enqueueSave({ name: value });
            }}
          />
          <InlineProfileField
            label={t`Title`}
            editLabel={t`Edit label`}
            placeholder={t`Add a label`}
            value={title}
            maxLength={BOT_TITLE_MAX_LENGTH}
            className="mt-1 text-sm text-muted-foreground"
            onCommit={(value) => {
              setTitle(value.trim());
              void enqueueSave({ title: value });
            }}
          />
          <Textarea
            aria-label={t`Description`}
            value={description}
            maxLength={BOT_DESCRIPTION_MAX_LENGTH}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => void enqueueSave()}
            placeholder={t`What this agent does`}
            rows={2}
            className="mt-2 min-h-10 w-full resize-none border-0 bg-transparent p-0 text-center text-sm text-muted-foreground shadow-none field-sizing-content"
          />
        </div>
        {!bot.agentEngine || bot.agentEngine === "pi" ? (
          <section ref={modelRef} className="mt-6" data-testid="bot-model-settings">
            <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground pe-1">
              <Trans>Model for this agent</Trans>
              {onOpenConnections ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t`Model connections`}
                  onClick={onOpenConnections}
                >
                  <Settings className="size-4" />
                </Button>
              ) : null}
            </div>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              <Trans>
                Only affects this agent. Choose the space default to use the general model.
              </Trans>
            </p>
            <div className="rounded-xl bg-muted/50 p-4 space-y-3">
              <div className="flex min-h-11 items-center justify-between gap-3">
                <label htmlFor={`${ids}-model`} className="sr-only">
                  <Trans>Model</Trans>
                </label>
                <div className="min-w-0 w-full [&>div]:mt-0 [&>button]:mt-0">
                  <ChatModelPicker
                    id={`${ids}-model`}
                    choices={modelChoices}
                    value={selectedModelKey}
                    onChange={(key) => {
                      setModelKey(key);
                      setThinkingLevel("");
                    }}
                  />
                </div>
              </div>
              {thinkingOptions.length ? (
                <label
                  htmlFor={`${ids}-thinking`}
                  className="flex min-h-11 items-center justify-between gap-3 text-sm text-foreground"
                >
                  <Trans>Thinking</Trans>
                  <NativeSelect
                    id={`${ids}-thinking`}
                    className="max-w-2/3"
                    value={thinkingLevel}
                    onChange={(event) => setThinkingLevel(event.target.value)}
                  >
                    <NativeSelectOption value="">
                      {t`Default (${thinkingLevelLabel(defaultThinkingLevel)})`}
                    </NativeSelectOption>
                    {thinkingOptions.map((level) => (
                      <NativeSelectOption key={level} value={level}>
                        {thinkingLevelLabel(level)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
              ) : null}
            </div>
          </section>
        ) : null}
        <SettingsLinks label={t`Knows`}>
          <SettingsLink page="instructions" icon={FileText} label={t`Instructions`} onClick={() => setPage("instructions")} />
          <SettingsLink page="memory" icon={BookOpen} label={t`Memories`} onClick={() => setPage("memory")} />
          <SettingsLink page="skills" icon={Puzzle} label={t`Skills`} onClick={() => setPage("skills")} />
          {onOpenFiles ? <SettingsLink icon={Folder} label={t`Files`} onClick={onOpenFiles} /> : null}
        </SettingsLinks>
        <SettingsLinks label={t`Does`}>
          {onOpenRoutines ? <SettingsLink icon={CalendarClock} label={t`Routines`} onClick={onOpenRoutines} /> : null}
          {onOpenUsage ? <SettingsLink icon={Gauge} label={t`Usage`} onClick={onOpenUsage} /> : null}
          <SettingsLink icon={Download} label={t`Export agent`} onClick={() => void onExport()} />
        </SettingsLinks>
        <SettingsLinks label={t`Rules`}>
          <SettingsLink page="computer" icon={Monitor} label={t`Computer`} detail={computerLabel} onClick={() => setPage("computer")} />
          <SettingsLink page="permissions" icon={ShieldCheck} label={t`Access`} onClick={() => setPage("permissions")} />
          <SettingsLink page="advanced" icon={SlidersHorizontal} label={t`Advanced`} onClick={() => setPage("advanced")} />
        </SettingsLinks>
        <section className="mt-6">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">
            <Trans>Notifications</Trans>
          </h3>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-4">
            <div>
              <label
                htmlFor={`${ids}-notify-finish`}
                id={`${ids}-notify-finish-label`}
                className="text-sm"
              >
                <Trans>When it finishes or needs input</Trans>
              </label>
            </div>
            <Switch
              id={`${ids}-notify-finish`}
              checked={notifyOnFinish}
              aria-labelledby={`${ids}-notify-finish-label`}
              onCheckedChange={(checked) => {
                setNotifyOnFinish(checked);
                void enqueueSave({ notifyOnFinish: checked });
              }}
            />
          </div>
        </section>
      </div>

      {page ? (
        <div className="mb-5 flex items-center gap-2 border-b border-border pb-3">
          <Button variant="ghost" size="icon-sm" aria-label={t`Back`} onClick={() => setPage(null)}>
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Button>
          <h2 ref={pageHeadingRef} tabIndex={-1} className="text-sm font-semibold outline-none">
            {pageTitles[page]}
          </h2>
        </div>
      ) : null}
      <div hidden={page !== "instructions"}>
        <InstructionSettings key={bot.id} bot={bot} />
      </div>
      {page === "memory" ? (
        <div className="space-y-5 [&>section]:mt-0">
          <ErrorBoundary fallback={<SectionLoadFailed />}>
            <Suspense fallback={null}>
              <ScratchpadSection botId={bot.id} />
            </Suspense>
          </ErrorBoundary>
          <ErrorBoundary fallback={<SectionLoadFailed />}>
            <Suspense fallback={null}>
              <KnowledgeSection botId={bot.id} />
            </Suspense>
          </ErrorBoundary>
        </div>
      ) : null}
      {page === "skills" ? (
        <ErrorBoundary fallback={<SectionLoadFailed />}>
          <Suspense fallback={null}>
            <KnowledgeSection botId={bot.id} skillsOnly />
          </Suspense>
        </ErrorBoundary>
      ) : null}
      {page === "computer" ? (
        <SettingsGroup label={t`Computer`}>
          <ComputerModePicker
            value={computerMode}
            onChange={setComputerMode}
            desktopAvailable={Boolean(onUseThisComputer)}
          />
          {onUseThisComputer && computerMode === "dedicated" ? (
            <Button
              variant="secondary"
              size="sm"
              className="mt-3 w-full"
              disabled={computerBusy}
              aria-busy={computerBusy}
              onClick={() => void switchToThisComputer()}
            >
              {computerBusy ? t`Connecting…` : t`Use this PC`}
            </Button>
          ) : null}
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            <Trans>
              Cloud/Team runs on a shared computer on the server and does not see files on your PC.
              This PC runs on your desktop with your folders, shell and tools.
            </Trans>
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            <Trans>
              If this PC is offline, the turn stops. It never moves to the cloud without your
              permission.
            </Trans>
          </p>
          {memoryProviderConfigured ? (
            <div className="mt-4 text-sm text-foreground">
              <Trans>Memory scope</Trans>
              <div className="mt-2 flex gap-2">
                {(
                  [
                    { value: null, label: t`Inherit default` },
                    { value: "isolated" as const, label: t`Isolated` },
                    { value: "shared" as const, label: t`Shared` },
                  ] satisfies Array<{ value: "isolated" | "shared" | null; label: string }>
                ).map((option) => (
                  <Toggle
                    key={option.label}
                    variant="outline"
                    size="sm"
                    pressed={memoryScope === option.value}
                    onPressedChange={(pressed) => {
                      if (pressed) setMemoryScope(option.value);
                    }}
                    className="flex-1 aria-pressed:border-foreground/40 aria-pressed:text-foreground"
                  >
                    {option.label}
                  </Toggle>
                ))}
              </div>
            </div>
              ) : null}
            </SettingsGroup>
      ) : null}
      {page === "permissions" ? (
        <SettingsGroup label={t`Permissions`}>
          <div className="flex min-h-11 items-center justify-between gap-3 text-sm">
            <label htmlFor={`${ids}-cross-space`} className={rowLabelClass}>
              <Trans>Allow cross-space bot communication</Trans>
            </label>
            <Switch
              id={`${ids}-cross-space`}
              checked={crossSpaceCommunication}
              disabled={saving}
              onCheckedChange={(checked) => {
                setCrossSpaceCommunication(checked);
                void enqueueSave({ crossSpaceCommunication: checked });
              }}
            />
          </div>
          <div className="flex min-h-11 items-center justify-between gap-3 text-sm">
            <div>
              <label htmlFor={`${ids}-fleet-management`} className={rowLabelClass}>
                <Trans>Manage the bots it creates</Trans>
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                <Trans>Can edit and organise bots it creates</Trans>
              </p>
            </div>
            <Switch
              id={`${ids}-fleet-management`}
              checked={fleetManagement}
              disabled={saving}
              onCheckedChange={(checked) => {
                setFleetManagement(checked);
                void enqueueSave({ fleetManagement: checked });
              }}
            />
          </div>
        </SettingsGroup>
      ) : null}
      {page === "advanced" ? (
        <div className="space-y-5">
          <SettingsGroup label={t`Voice`}>
            <label
              htmlFor={`${ids}-auto-speak`}
              className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm text-foreground"
            >
              <span className={rowLabelClass}>
                <Trans>Read replies aloud</Trans>
              </span>
              <Switch
                id={`${ids}-auto-speak`}
                checked={autoSpeak}
                onCheckedChange={(checked) => setAutoSpeak(checked)}
              />
            </label>
            {voices?.length ? (
              <label
                htmlFor={`${ids}-voice`}
                className="flex min-h-11 items-center justify-between gap-3 text-sm text-foreground"
              >
                <Trans>Voice</Trans>
                <NativeSelect
                  id={`${ids}-voice`}
                  className="max-w-2/3"
                  value={voiceId}
                  onChange={(event) => setVoiceId(event.target.value)}
                >
                  <NativeSelectOption value="">{t`Account default`}</NativeSelectOption>
                  {voices.map((voice) => (
                    <NativeSelectOption key={voice.id} value={voice.id}>
                      {voice.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
            ) : null}
          </SettingsGroup>
          <SettingsGroup label={t`Tools`}>
            <section data-testid="bot-settings-tools">
              <div className="space-y-4 [&>*]:mt-0">
                <div>
                  <NativeSelect
                    id={`${ids}-disabled-tools`}
                    aria-label={t`Disable a tool`}
                    value=""
                    onChange={(event) => disableBuiltinTool(event.target.value)}
                    className="w-full"
                  >
                    <NativeSelectOption value="">{t`Disable a tool`}</NativeSelectOption>
                    {BUILTIN_TOOL_NAMES.filter(
                      (name) => !disabledBuiltinTools.includes(name),
                    ).map((name) => (
                      <NativeSelectOption key={name} value={name}>
                        {humanizeTool(name)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                {disabledBuiltinTools.map((toolName) => (
                  <div
                    key={toolName}
                    className="flex min-h-11 items-center justify-between gap-3 text-sm"
                  >
                    <span>{humanizeTool(toolName)}</span>
                    <Button
                      id={`${ids}-disabled-${toolName}`}
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t`Enable ${humanizeTool(toolName)}`}
                      title={t`Enable ${humanizeTool(toolName)}`}
                      onClick={() => {
                        const next = disabledBuiltinTools.filter((entry) => entry !== toolName);
                        setDisabledBuiltinTools(next);
                        void enqueueSave({ disabledBuiltinTools: next });
                      }}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          </SettingsGroup>
          <BotCredentialsSection botId={bot.id} />
          <div className="overflow-hidden rounded-xl bg-muted/50 px-4">
            <button
              type="button"
              className="flex min-h-12 w-full items-center justify-between text-sm"
              onClick={() => void onExport()}
            >
              <Trans>Export</Trans>
              <Download className="size-4 text-muted-foreground" />
            </button>
            <button
              type="button"
              className="min-h-12 w-full border-t border-border text-start text-sm text-destructive"
              onClick={onClear}
            >
              <Trans>Clear conversation</Trans>
            </button>
            {onUndoImport ? <AgentImportUndo botId={bot.id} onUndone={onUndoImport} /> : null}
          </div>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
      {dirty ? (
        <Button
          className="sticky bottom-0 mt-5 w-full"
          disabled={saving}
          onClick={() => {
            void enqueueSave({
              name,
              title,
              description,
              color,
              notifyOnFinish,
            });
          }}
        >
          <Trans>Save</Trans>
        </Button>
      ) : null}
    </div>
  );
}

const NO_CREDENTIALS: never[] = [];
const NO_CATALOG: ModelCatalogEntry[] = [];

function sameStringList(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function InlineProfileField({
  label,
  editLabel,
  value,
  placeholder,
  maxLength,
  className,
  onCommit,
}: {
  label: string;
  editLabel: string;
  value: string;
  placeholder?: string;
  maxLength: number;
  className: string;
  onCommit: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  function commit() {
    if (cancelled.current) return;
    setEditing(false);
    if (draft.trim() !== value.trim()) onCommit(draft);
  }
  return editing ? (
    <Input
      autoFocus
      aria-label={label}
      value={draft}
      maxLength={maxLength}
      className={`h-auto border-transparent bg-transparent p-0 text-center shadow-none ${className}`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") {
          cancelled.current = true;
          setEditing(false);
        }
      }}
    />
  ) : (
    <button
      type="button"
      aria-label={editLabel}
      className={`min-w-0 max-w-full cursor-text break-words rounded px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
      onClick={() => {
        cancelled.current = false;
        setDraft(value);
        setEditing(true);
      }}
    >
      {value || placeholder}
    </button>
  );
}

function SettingsGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">{label}</h3>
      <div className="space-y-3 rounded-xl bg-muted/50 p-4 [&>*]:mt-0">{children}</div>
    </section>
  );
}

function SettingsLinks({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">{label}</h3>
      <div className="divide-y divide-border overflow-hidden rounded-xl bg-muted/50">{children}</div>
    </section>
  );
}

function SettingsLink({
  page,
  icon: Icon,
  label,
  detail,
  onClick,
}: {
  page?: BotSettingsPage;
  icon: typeof FileText;
  label: string;
  detail?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-settings-page={page}
      className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-start text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={onClick}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">{label}</span>
      {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
    </button>
  );
}

function humanizeTool(name: string) {
  const words = name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

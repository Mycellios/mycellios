import { useLingui } from "@lingui/react/macro";
import type { Bot, Me, ModelCatalogEntry, ModelCredential, ThinkingLevel } from "@mycellios/contracts";
import { ThinkingLevelSchema, isMycelliosBaseUrl, OPENAI_COMPATIBLE_PROVIDER_ID } from "@mycellios/contracts";
import { chatModelChoices, connectedModelChoices, credentialForModel, modelOptionKey, parseModelOptionKey, resolveSelectableModelId } from "@mycellios/core";
import { Button, OptionSelect, Popover, PopoverContent, PopoverTrigger, Spinner, Switch } from "@mycellios/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Cpu } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { generalChatModel, selectableCatalogEntry, thinkingLevelLabel } from "../../lib/model-catalog";
import { useSpaceQueries, writeSaved } from "../../lib/query";
import { useSpaceRpc } from "../../lib/space-rpc";
import { readCachedMycelliosCatalog, writeCachedMycelliosCatalog } from "../../lib/mycellios-catalog-cache";
import { errorText } from "../../lib/user-error";
import { enableCompatibleModel, savedModelIds } from "../model-settings/enable-compatible-model";
import { ChatModelPicker } from "./chat-model-picker";
import { ChatModelCatalog, type ChatModelCatalogSource } from "./chat-model-catalog";
import { ProviderLogo } from "../../components/ProviderLogo";
import { MycelliosProvider } from "../model-settings/mycellios-provider";
import { NativeEngineAccount } from "./native-engine-account";
import { NativeEngineInstall, NativeEngineUpdateOffer } from "./native-engine-install";
import { LocalModelsPanel } from "./local-models-panel";
import { isDeviceModelChoice, localModelsBridge, useLocalModels } from "../../lib/local-models";

const EMPTY_CREDENTIALS: ModelCredential[] = [];
const EMPTY_CATALOG: ModelCatalogEntry[] = [];
export type ChatModelPatch = Pick<Bot, "modelProvider" | "modelId" | "thinkingLevel"> & {
  agentEngine?: Bot["agentEngine"];
  nativeConfig?: Bot["nativeConfig"];
};

const NATIVE_PROVIDERS = { codex: "ChatGPT", claude: "Claude Code", opencode: "OpenCode", acp: "ACP" } as const;
type NativeProvider = keyof typeof NATIVE_PROVIDERS;

function selectedNativeProvider(provider: string): NativeProvider | undefined {
  return (Object.keys(NATIVE_PROVIDERS) as NativeProvider[]).find(engine => provider === `native-${engine}`);
}

function connectionName(connection: ModelCredential) {
  if (isMycelliosBaseUrl(connection.baseUrl)) return "Mycellios";
  if (!connection.baseUrl || !/^OpenAI.compatible(?: \d+)?$/i.test(connection.label)) return connection.label;
  try {
    const { hostname } = new URL(connection.baseUrl);
    return hostname.split(".")[0] === "omniroute" ? "OmniRoute" : hostname;
  } catch {
    return connection.label;
  }
}

/** How long the header, which remounts for every Mico, reuses account and catalog reads. */
export const HEADER_MODEL_REUSE_MS = 5 * 60_000;
/** Opening the picker rereads connections and catalog older than the usual freshness window. */
const PICKER_FRESH_MS = 30_000;
const ENGINES_REUSE_MS = 60_000;

export function ChatHeaderModel({ bot, me: initialMe, onSave, onConnections, recovery = false, inMenu = false }: {
  bot: Bot;
  me: Me | null | undefined;
  onSave: (patch: ChatModelPatch) => Promise<void>;
  onConnections: () => void;
  recovery?: boolean;
  inMenu?: boolean;
}) {
  const { t } = useLingui();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [lastProvider, setLastProvider] = useState<string | null>(null);
  const [pickerRevision, setPickerRevision] = useState(0);
  const [exploring, setExploring] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const rpc = useSpaceRpc();
  // The header remounts for every Mico, so it reuses recent account reads; opening the picker
  // refreshes the connections and catalog it lists.
  const reuse = { refetchOnMount: true, staleTime: HEADER_MODEL_REUSE_MS } as const;
  const meQuery = useQuery({ ...queries.me.queryOptions(), ...reuse, enabled: Boolean(initialMe) });
  const me = meQuery.data ?? initialMe;
  const credentialsQuery = useQuery({ ...queries.models.credentials.queryOptions(), ...reuse, enabled: Boolean(me) });
  const catalogQuery = useQuery({ ...queries.models.list.queryOptions(), ...reuse, enabled: Boolean(me) });
  const refreshPicker = () => {
    for (const query of [credentialsQuery, catalogQuery]) if (Date.now() - query.dataUpdatedAt > PICKER_FRESH_MS) void query.refetch();
  };
  // The PC's engines and models are asked for as soon as the pointer or focus reaches the button,
  // so the list is usually there when the picker opens; a recent answer is reused for a minute.
  const [wantEngines, setWantEngines] = useState(false);
  const enginesQuery = useQuery({ ...queries.engines.forBot.queryOptions({ input: { botId: bot.id } }),
    enabled: open || wantEngines, staleTime: ENGINES_REUSE_MS });
  const refetchEngines = enginesQuery.refetch;
  const refreshEngines = useCallback(() => void refetchEngines(), [refetchEngines]);
  // Servers that predate per-computer catalogs only list Codex models of their own CLI.
  const nativeCatalog = useQuery(queries.engines.codexModels.queryOptions({
    enabled: open && enginesQuery.data?.computer === "server" && !enginesQuery.data.models && enginesQuery.data.engines.includes("codex"),
  }));
  const engineModels = (engine: "codex" | "claude" | "opencode") => enginesQuery.data?.models?.[engine] ??
    (engine === "codex" && enginesQuery.data?.computer === "server" ? nativeCatalog.data ?? [] : []);
  const catalogEngine = bot.agentEngine === "codex" || bot.agentEngine === "claude" || bot.agentEngine === "opencode" ? bot.agentEngine : null;
  const nativeModels = catalogEngine ? engineModels(catalogEngine) : [];
  const nativeModel = nativeModels.find(model => bot.nativeConfig?.modelId ? model.id === bot.nativeConfig.modelId : model.isDefault);
  const credentials = credentialsQuery.data ?? EMPTY_CREDENTIALS;
  const mycelliosConnection = credentials.find(connection => isMycelliosBaseUrl(connection.baseUrl));
  const catalogScope = [me?.userId, me?.spaceId, mycelliosConnection?.id] as const;
  const mycelliosCatalog = useQuery({
    queryKey: ["mycellios-chat-catalog", ...catalogScope],
    queryFn: async ({ signal }) => {
      const models = await rpc.models.mycelliosModels(undefined, { context: { spaceId: me!.spaceId }, signal });
      writeCachedMycelliosCatalog(catalogScope, models);
      return models;
    },
    // The last catalog read on this device shows at once while the live one loads.
    placeholderData: () => readCachedMycelliosCatalog(catalogScope),
    enabled: (open || Boolean((bot.modelId ?? me?.defaultModel)?.startsWith("mycellios/"))) && Boolean(me && mycelliosConnection),
    staleTime: 60_000,
    // A coordinator restart lasts minutes: try again a few times before saying anything.
    retry: 3,
    retryDelay: attempt => Math.min(2_000 * 2 ** attempt, 15_000),
    refetchInterval: query => query.state.data?.length === 0 ? 5_000 : false,
  });
  const catalog = [
    ...(catalogQuery.data ?? EMPTY_CATALOG).filter(entry => entry.providerName !== "Mycellios" && !entry.id.startsWith("mycellios/")),
    ...(mycelliosCatalog.data ?? []),
  ];
  const general = generalChatModel(me, catalog);
  // Models on this PC (specs/local-models/spec.md): offered in Desktop for a Mico that runs here.
  const deviceSelected = isDeviceModelChoice(bot.modelProvider) && Boolean(bot.modelId);
  const onYourPc = t`On your PC`;
  // The Mico's own choice ("Your PC") decides; the engines report only knows a bound computer.
  const deviceOffered = Boolean(localModelsBridge()) &&
    (deviceSelected || bot.computerMode === "dedicated" || enginesQuery.data?.computer === "desktop");
  const local = useLocalModels(deviceOffered && (open || deviceSelected));
  // Opening the chat loads the model and its saved prompt, so the first answer starts at once.
  const warmModelId = deviceSelected && !(bot.agentEngine && bot.agentEngine !== "pi") ? bot.modelId : null;
  useEffect(() => {
    if (warmModelId) void localModelsBridge()?.warm?.(warmModelId).catch(() => undefined);
  }, [warmModelId]);
  const deviceName = (modelId: string) => local.status?.models.find(model => model.id === modelId)?.name ?? modelId;
  const nativeEngine = bot.agentEngine && bot.agentEngine !== "pi" ? bot.agentEngine : null;
  const nativeName = nativeEngine ? NATIVE_PROVIDERS[nativeEngine] : undefined;
  const override = bot.modelProvider && bot.modelId
    ? { provider: bot.modelProvider, modelId: bot.modelId }
    : null;
  const provider = override?.provider ?? general?.provider;
  const model = override?.modelId ?? general?.modelId;
  const effectiveId = provider && model ? resolveSelectableModelId(catalog, provider, model) : null;
  const entry = provider && model ? selectableCatalogEntry(catalog, provider, model) : undefined;
  const credential = credentialForModel(credentials, provider ?? null, effectiveId ?? null);
  const levels = catalogEngine ? (nativeModel?.thinkingLevels ?? []).flatMap(level => { const parsed = ThinkingLevelSchema.safeParse(level); return parsed.success ? [parsed.data] : []; }) : nativeEngine ? [] : (credential?.thinkingLevels ?? entry?.thinkingLevels ?? []).filter(level => level !== "off");
  const value = nativeEngine ? modelOptionKey(`native-${nativeEngine}`, catalogEngine ? bot.nativeConfig?.modelId ?? nativeModel?.id ?? "default" : "default")
    : bot.modelProvider && bot.modelId ? modelOptionKey(bot.modelProvider, resolveSelectableModelId(catalog, bot.modelProvider, bot.modelId)) : "";
  const sources = new Map<string, { provider: string }>();
  sources.set("Mycellios", { provider: OPENAI_COMPATIBLE_PROVIDER_ID });
  if (deviceOffered) sources.set(onYourPc, { provider: "device" });
  const connectionLabels = new Set<string>();
  const namedCredentials = credentials.map(connection => {
    const name = connectionName(connection);
    const label = connectionLabels.has(name) ? `${name} · ${connection.label}` : name;
    connectionLabels.add(name);
    sources.set(label, { provider: connection.provider });
    return { ...connection, label };
  });
  // Personal providers retain opt-in discovery. Mycellios continues to use only
  // the canonical account catalog and its bounded Credit admission.
  const personalCatalogs: ChatModelCatalogSource[] = namedCredentials
    .filter(connection => connection.baseUrl && !isMycelliosBaseUrl(connection.baseUrl))
    .map(connection => ({ label: connection.label, provider: connection.provider, connection, models: [] }));
  const explorer = personalCatalogs.find(source => source.label === exploring);
  // The account catalog is authoritative for Mycellios, not its saved enabled IDs.
  const connected = connectedModelChoices(namedCredentials.filter(connection => !isMycelliosBaseUrl(connection.baseUrl)), catalog.filter(entry => entry.providerName !== "Mycellios"))
    .concat(mycelliosConnection ? (mycelliosCatalog.data ?? []).map(entry => ({
      key: modelOptionKey(entry.provider, entry.id), provider: entry.provider, modelId: entry.id,
      label: entry.label, providerLabel: "Mycellios", modelLabel: entry.label, images: entry.images,
    })) : []).map(choice => {
    const connection = credentialForModel(namedCredentials, choice.provider, choice.modelId)
      ?? namedCredentials.find(entry => entry.provider === choice.provider && entry.label === choice.providerLabel)
      ?? namedCredentials.find(entry => entry.provider === choice.provider);
    const label = mycelliosCatalog.data?.some(entry => entry.provider === choice.provider && entry.id === choice.modelId)
      ? "Mycellios" : connection?.label ?? choice.providerLabel ?? choice.provider;
    if (!sources.has(label)) sources.set(label, { provider: choice.provider });
    const name = choice.modelLabel && choice.modelLabel !== choice.modelId ? choice.modelLabel
      : choice.modelId.startsWith("mycellios/") ? choice.modelId.split("/").at(-1)! : choice.modelId;
    return { ...choice, providerLabel: label, label: `${name} (${label})`, title: name };
  });
  const defaultKey = general ? modelOptionKey(general.provider, resolveSelectableModelId(catalog, general.provider, general.modelId)) : "";
  // A saved first-party model identifies Mycellios even before discovery returns.
  const currentProvider = nativeName ?? (deviceSelected ? onYourPc : undefined) ?? (model?.startsWith("mycellios/") || credential && isMycelliosBaseUrl(credential.baseUrl)
    ? "Mycellios" : connected.find((choice) => choice.key === (value || defaultKey))?.providerLabel ?? entry?.providerName ?? provider);
  const engineState = enginesQuery.data;
  // A CLI missing on the owner's PC keeps its provider, with Install (older Desktops cannot install).
  const installable = engineState?.computer === "desktop" && engineState.install ? engineState.installable ?? [] : [];
  // The saved engine remains visible when its host is temporarily unavailable.
  const nativeProviders = [...new Set<NativeProvider>([
    ...(engineState?.engines ?? []),
    ...(nativeEngine ? [nativeEngine] : []),
    ...installable.map(release => release.engine),
  ])];
  // A CLI that is missing or reported nobody signed in would fail its first turn: say why instead.
  // The Mico's current engine stays selectable so its saved choice is never hidden.
  const signedOut = new Set<string>(engineState?.signedOut ?? []);
  const missing = new Set<string>(installable.map(release => release.engine));
  const signInRequired = (engine: NativeProvider) => engine === nativeEngine ? {}
    : missing.has(engine) ? { unavailable: true, unavailableLabel: t`Not installed` }
      : signedOut.has(engine) ? { unavailable: true, unavailableLabel: t`Sign in required` } : {};
  // The PC's own CLI signs in and out from the provider it belongs to (older Desktops cannot).
  const accountEngine = engineState?.computer === "desktop" && engineState.account
    ? (["codex", "claude"] as const).find(engine =>
      NATIVE_PROVIDERS[engine] === (lastProvider ?? currentProvider) && engineState.engines.includes(engine))
    : undefined;
  const installRelease = installable.find(release => NATIVE_PROVIDERS[release.engine] === (lastProvider ?? currentProvider));
  const installProgress = installRelease && engineState?.installing?.find(item => item.engine === installRelease.engine);
  const updateEngine = engineState?.computer === "desktop" && engineState.install && !installRelease
    ? (["codex", "claude", "opencode"] as const).find(engine =>
      NATIVE_PROVIDERS[engine] === (lastProvider ?? currentProvider))
    : undefined;
  // An engine whose CLI listed its models offers each one; otherwise its account default.
  const listed = (engine: NativeProvider) => engine === "acp" ? [] : engineModels(engine);
  // OpenCode without a model of its own keeps a row for whatever it picks by itself.
  const nativeChoices = nativeProviders.filter(engine => !listed(engine).length ||
    engine === "opencode" && !listed(engine).some(model => model.isDefault)).map(engine => ({
    key: modelOptionKey(`native-${engine}`, "default"), provider: `native-${engine}`,
    providerLabel: NATIVE_PROVIDERS[engine], label: NATIVE_PROVIDERS[engine] as string,
    title: engine === "opencode" ? t`Model set in OpenCode` : t`Use this account`,
    ...signInRequired(engine),
  }));
  for (const engine of nativeProviders) nativeChoices.push(...listed(engine).map(model => ({
    key: modelOptionKey(`native-${engine}`, model.id), provider: `native-${engine}`, providerLabel: NATIVE_PROVIDERS[engine],
    label: model.label, title: model.label, ...signInRequired(engine),
  })));
  const choices = [...chatModelChoices(
    connected,
    value || defaultKey,
    "",
  ).filter((choice) => choice.key && !selectedNativeProvider(choice.provider ?? "")).map(choice => {
    const unavailable = Boolean(mycelliosConnection && choice.provider === mycelliosConnection.provider &&
      (choice.modelId?.startsWith("mycellios/") || savedModelIds(mycelliosConnection).includes(choice.modelId ?? "")) &&
      !connected.some(entry => entry.key === choice.key));
    return unavailable ? { ...choice, title: choice.modelId?.startsWith("mycellios/") ? choice.modelId.split("/").at(-1) : choice.modelId,
      providerLabel: "Mycellios", unavailable: true } : choice;
  }), ...nativeChoices, ...(deviceSelected ? [{
    key: modelOptionKey("device", bot.modelId!), provider: "device", providerLabel: onYourPc,
    label: `${deviceName(bot.modelId!)} (${onYourPc})`, title: deviceName(bot.modelId!),
  }] : [])];
  const label = recovery ? t`Change model` : deviceSelected && !nativeEngine ? deviceName(bot.modelId!) : (catalogEngine ? nativeModel?.label ?? bot.nativeConfig?.modelId ?? nativeName : nativeName) ?? connected.find(choice => choice.key === (value || defaultKey))?.title ?? entry?.label ?? (model?.startsWith("mycellios/") ? model.split("/").at(-1) : model) ?? (me?.needsModel ? t`Choose a model` : t`Model`);
  const headerEffort = ThinkingLevelSchema.safeParse(catalogEngine ? bot.nativeConfig?.thinkingLevel ?? nativeModel?.defaultThinkingLevel : nativeEngine ? undefined : bot.thinkingLevel);
  const effortLabel = headerEffort.success && headerEffort.data !== "off" ? thinkingLevelLabel(headerEffort.data) : null;
  const queryError = credentialsQuery.error ?? catalogQuery.error;

  async function save(apply: () => Promise<void>, close = true) {
    if (busy.current) return;
    busy.current = true; setSaving(true); setError(null);
    try {
      await apply();
      setExploring(null);
      if (close) setOpen(false);
    }
    catch (cause) { setError(errorText(cause)); }
    finally { busy.current = false; setSaving(false); }
  }

  function pickCatalog(modelId: string, use: boolean) {
    if (!explorer || !me || !explorer.connection) return;
    const source = explorer, original = explorer.connection;
    void save(async () => {
      const context = { spaceId: me.spaceId };
      const latest = await rpc.models.credentials(undefined, { context });
      const connection = latest.find(entry => entry.id === original.id);
      if (!connection || connection.baseUrl !== original.baseUrl || isMycelliosBaseUrl(connection.baseUrl))
        throw new Error(t`This connection has changed. Open the catalog again.`);
      if (use && latest.some(entry => entry.id !== connection.id && entry.provider === connection.provider && savedModelIds(entry).includes(modelId)))
        throw new Error(t`This model is already enabled on another connection. Use it from that connection.`);
      const updated = await enableCompatibleModel(rpc, me.spaceId, connection, modelId, t`This connection has reached its enabled model limit.`);
      await writeSaved(queryClient, queries.models.credentials.queryKey(), () => latest.map(entry => entry.id === updated.id
        ? { ...entry, modelId: entry.modelId ?? updated.modelId, enabledModelIds: updated.enabledModelIds } : entry));
      if (use) await onSave({ agentEngine: "pi", modelProvider: source.provider, modelId, thinkingLevel: null });
    }, use);
  }

  function choose(key: string) {
    if (choices.some(choice => choice.key === key && "unavailable" in choice && choice.unavailable)) return;
    const selected = key ? parseModelOptionKey(key) : null;
    const engine = selected ? selectedNativeProvider(selected.provider) : undefined;
    void save(async () => {
      if (selected && mycelliosConnection && selected.provider === mycelliosConnection.provider &&
        mycelliosCatalog.data?.some(entry => entry.id === selected.modelId) && me) {
        const latest = await rpc.models.credentials(undefined, { context: { spaceId: me.spaceId } });
        const connection = latest.find(entry => entry.id === mycelliosConnection.id);
        if (!connection || connection.baseUrl !== mycelliosConnection.baseUrl) throw new Error(t`This connection has changed. Open the catalog again.`);
        if (latest.some(entry => entry.id !== connection.id && entry.provider === connection.provider && savedModelIds(entry).includes(selected.modelId))) {
          throw new Error(t`This model is already enabled on another connection. Use it from that connection.`);
        }
        const updated = await enableCompatibleModel(rpc, me.spaceId, connection, selected.modelId, t`This connection has reached its enabled model limit.`);
        await writeSaved(queryClient, queries.models.credentials.queryKey(), () => latest.map(entry => entry.id === updated.id ? { ...entry, enabledModelIds: updated.enabledModelIds } : entry));
      }
      await onSave({
      agentEngine: engine ?? "pi",
      nativeConfig: engine === "codex" ? { modelId: selected?.modelId === "default" ? null : selected?.modelId,
        fastMode: false, thinkingLevel: null }
        // Another Claude Code model keeps the owner's configuration switch as it was.
        : engine === "claude" ? { modelId: selected?.modelId === "default" ? null : selected?.modelId, thinkingLevel: null,
          ...(bot.agentEngine === "claude" && bot.nativeConfig?.userSettings ? { userSettings: true } : {}) }
        // OpenCode runs the chosen provider/model; its own default otherwise.
        : engine === "opencode" && selected?.modelId && selected.modelId !== "default" ? { modelId: selected.modelId } : null,
      modelProvider: engine ? null : selected?.provider ?? null,
      modelId: engine ? null : selected?.modelId ?? null,
      thinkingLevel: null,
      });
    });
  }
  return (
    <div className={recovery ? "ml-2 inline-flex" : "app-no-drag flex min-w-0 shrink-0 items-center gap-0.5"} data-testid={recovery ? "composer-error-model" : "chat-header-model"}>
      <Popover modal={recovery} open={open} onOpenChange={next => { if (!busy.current) { setOpen(next); setExploring(null); setLastProvider(null); setError(null); if (next && me) refreshPicker(); } }}>
        <PopoverTrigger type="button" title={label} onPointerEnter={() => setWantEngines(true)} onFocus={() => setWantEngines(true)} data-mobile-chat-action={inMenu || undefined} aria-label={recovery ? label : t`Model`} className={recovery
          ? "inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:text-foreground"
          : "app-no-drag flex h-8 min-w-0 max-w-64 items-center gap-1.5 rounded-md px-2 text-xs font-normal text-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring @max-[32rem]:size-8 @max-[32rem]:justify-center @max-[32rem]:gap-0 @max-[32rem]:px-0"}>
          {inMenu ? <><Cpu aria-hidden /><span>{t`Model`}</span><span className="ms-auto min-w-0 truncate text-xs text-muted-foreground">{label}</span></> : (
            <>
              {!recovery && (nativeName || provider) ? <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center [&_*]:size-3.5"><ProviderLogo name={nativeName ?? currentProvider ?? provider ?? ""} providerId={nativeEngine ?? provider} /></span> : null}
              {!recovery && !nativeName && !provider ? <Cpu size={14} aria-hidden className="hidden @max-[32rem]:block" /> : null}
              <span className={`min-w-0 truncate ${recovery ? "" : "@max-[32rem]:hidden"}`}>{label}</span>
              {!recovery && effortLabel ? <span className="shrink-0 text-muted-foreground @max-[32rem]:hidden">· {effortLabel}</span> : null}
              <ChevronDown size={12} className={`shrink-0 text-muted-foreground ${recovery ? "" : "@max-[32rem]:hidden"}`} />
            </>
          )}
        </PopoverTrigger>
        {open ? <PopoverContent align="end" className={recovery
          ? "app-no-drag w-80 max-w-[calc(100vw-24px)] gap-3 p-3"
          : "app-no-drag w-[360px] max-w-[calc(100vw-24px)] max-h-(--available-height) gap-0 overflow-y-auto p-0"}>
          {recovery ? <label htmlFor={`${id}-model`} className="text-xs font-medium">{t`Model`}</label> : null}
          {recovery ? <p className="text-xs text-muted-foreground">{t`This changes the model for this Mico. Your message stays in the chat.`}</p> : null}
          {credentialsQuery.isPending || catalogQuery.isPending ? (
            <div className="grid min-h-28 place-items-center">
              <Spinner aria-label={t`Loading models…`} className="text-muted-foreground" />
            </div>
          ) : queryError ? <p role="alert" className="text-xs text-destructive">{errorText(queryError)}</p> :
            <fieldset disabled={saving} className="min-w-0 [&>div]:mt-0 [&>button]:mt-0">
              {explorer && me ? <ChatModelCatalog source={explorer} userId={me.userId} spaceId={me.spaceId}
                onBack={() => { setExploring(null); setError(null); }} onPick={pickCatalog} /> : <ChatModelPicker
                key={pickerRevision}
                id={`${id}-model`}
                choices={choices}
                value={value || defaultKey}
                defaultKey={catalogEngine ? modelOptionKey(`native-${catalogEngine}`, nativeModels.find(model => model.isDefault)?.id ?? "default") : defaultKey}
                inline={!recovery}
                onManage={() => { setOpen(false); onConnections(); }}
                onChange={choose}
                providerIds={Object.fromEntries([...sources].map(([name, source]) => [name, source.provider]))}
                initialProvider={lastProvider}
                onProviderChange={setLastProvider}
                catalogProviders={!recovery ? personalCatalogs.map(source => source.label) : undefined}
                onExplore={name => { setLastProvider(name); setExploring(name); setError(null); }}
                providerContent={name => name === onYourPc && deviceOffered ? <LocalModelsPanel disabled={saving}
                  value={deviceSelected ? bot.modelId : null}
                  onUse={modelId => save(() => onSave({ agentEngine: "pi", nativeConfig: null, modelProvider: "device", modelId, thinkingLevel: null }))} />
                  : name === "Mycellios" && !mycelliosConnection ? <ul><MycelliosProvider embedded onConnected={async () => {
                  await Promise.all([credentialsQuery.refetch(), catalogQuery.refetch(), queryClient.invalidateQueries({queryKey:queries.me.queryKey()})]);
                }} /></ul> : null}
                mycelliosCatalogReady={mycelliosCatalog.isSuccess}
                modelOrigins={Object.fromEntries((mycelliosCatalog.data ?? []).map(entry => [modelOptionKey(entry.provider, entry.id), entry.mycelliosProcessing === "external" ? "antseed" : "network"]))}
                freeModels={new Set((mycelliosCatalog.data ?? []).filter(entry => entry.mycelliosProcessing === "external" && entry.mycelliosPricing
                  && [entry.mycelliosPricing.input, entry.mycelliosPricing.output, entry.mycelliosPricing.request ?? "0"].every(price => Number(price) === 0))
                  .map(entry => modelOptionKey(entry.provider, entry.id)))}
                recommendedModels={new Set((mycelliosCatalog.data ?? []).filter(entry => entry.recommended).map(entry => modelOptionKey(entry.provider, entry.id)))}
              />}
            </fieldset>}
          {(["codex", "claude", "opencode"] as const).some(engine => NATIVE_PROVIDERS[engine] === (lastProvider ?? currentProvider) && !engineModels(engine).length)
            && enginesQuery.isFetching ? <p role="status" className="px-4 py-2 text-xs text-muted-foreground">{t`Loading models…`}</p> : null}
          {mycelliosConnection && (lastProvider ?? currentProvider) === "Mycellios" && mycelliosCatalog.isFetching ?<p role="status" className="px-4 py-2 text-xs text-muted-foreground">{t`Loading models…`}</p> : null}
          {mycelliosConnection && (lastProvider ?? currentProvider) === "Mycellios" && mycelliosCatalog.isError && !mycelliosCatalog.data?.length ? <p role="alert" className="px-4 py-2 text-xs text-destructive">{t`Could not load the catalog.`} <Button size="sm" variant="ghost" onClick={() => void mycelliosCatalog.refetch()}>{t`Retry`}</Button></p> : null}
          {mycelliosConnection && (lastProvider ?? currentProvider) === "Mycellios" && mycelliosCatalog.data?.length === 0 ? <p role="status" className="px-4 py-2 text-xs text-muted-foreground">{t`No Mycellios agent models are available right now. Retrying automatically.`}</p> : null}
          {!recovery && (!lastProvider || lastProvider === currentProvider) && levels.length ? <label className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-4 py-3 text-sm">{t`Effort`}
            <OptionSelect
              aria-label={t`Thinking`}
              className="w-48 min-w-48 shrink-0"
              value={(catalogEngine ? bot.nativeConfig?.thinkingLevel : bot.thinkingLevel) ?? ""}
              disabled={saving}
              options={[
                { value: "", label: t`Default` },
                ...levels.map((level) => ({ value: level, label: thinkingLevelLabel(level) })),
              ]}
              onValueChange={(value) => void save(() => onSave(catalogEngine
                ? { agentEngine: catalogEngine, modelProvider: null, modelId: null, thinkingLevel: null, nativeConfig: { ...bot.nativeConfig, thinkingLevel: (value || null) as ThinkingLevel | null } }
                : { modelProvider: bot.modelProvider, modelId: bot.modelId, thinkingLevel: (value || null) as ThinkingLevel | null }), false)}
            />
          </label> : null}
          {!recovery && (!lastProvider || lastProvider === currentProvider) && nativeEngine === "codex" && nativeModel?.fast ? <label className="flex items-center justify-between gap-3 px-4 pb-3 text-sm">
            <span title={t`Uses priority processing and may use more quota.`}>{t`Fast`}</span>
            <Switch aria-label={t`Fast`} checked={bot.nativeConfig?.fastMode === true} disabled={saving}
              onCheckedChange={fastMode => void save(() => onSave({ agentEngine: "codex", modelProvider: null, modelId: null, thinkingLevel: null, nativeConfig: { ...bot.nativeConfig, fastMode } }), false)} />
          </label> : null}
          {!recovery && (!lastProvider || lastProvider === currentProvider) && nativeEngine === "claude" && enginesQuery.data?.computer === "desktop" ? <label className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
            <span title={t`Loads your instructions, hooks and skills from Claude Code on this PC.`}>{t`Use my Claude Code settings`}</span>
            <Switch aria-label={t`Use my Claude Code settings`} checked={bot.nativeConfig?.userSettings === true} disabled={saving}
              onCheckedChange={userSettings => void save(() => onSave({ agentEngine: "claude", modelProvider: null, modelId: null, thinkingLevel: null, nativeConfig: { ...bot.nativeConfig, userSettings } }), false)} />
          </label> : null}
          {!recovery && accountEngine ? <NativeEngineAccount botId={bot.id} engine={accountEngine}
            signedOut={signedOut.has(accountEngine)} onChanged={refreshEngines} /> : null}
          {!recovery && installRelease ? <NativeEngineInstall botId={bot.id} release={installRelease}
            progress={installProgress} onChanged={refreshEngines} /> : null}
          {!recovery && updateEngine ? <NativeEngineUpdateOffer key={updateEngine} botId={bot.id}
            engine={updateEngine} release={engineState?.updates?.find(item => item.engine === updateEngine)}
            progress={engineState?.installing?.find(item => item.engine === updateEngine)}
            onChanged={refreshEngines} /> : null}
          {nativeEngine === "codex" && nativeCatalog.error && open ? <p role="status" className="px-4 py-2 text-xs text-muted-foreground">{t`Could not load this account's models. Fast mode is unavailable until the catalog can be checked.`}</p> : null}
          {!recovery && me && !queryError && (lastProvider ?? currentProvider) !== "Mycellios" ? <div className="border-t border-border px-4 py-3">
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => {
              setLastProvider("Mycellios"); setExploring(null); setError(null);
              setPickerRevision(revision => revision + 1);
            }}>{t`Explore models with my credits`}</Button>
            <p className="mt-1 text-xs text-muted-foreground">{t`Choose a model yourself. Switching keeps this Mico's chat and files.`}</p>
          </div> : null}
          {saving ? <Spinner aria-label={t`Saving…`} className="mx-auto my-2 text-muted-foreground" /> : null}
          {error ? <p role="alert" className="p-2 text-xs text-destructive">{error}</p> : null}
          {(recovery || !sources.size) ? <Button variant="ghost" size="sm" onClick={() => { setOpen(false); onConnections(); }}>{t`Manage models`}</Button> : null}
        </PopoverContent> : null}
      </Popover>
    </div>
  );
}

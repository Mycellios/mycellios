import { useLingui } from "@lingui/react/macro";
import type { Bot, Me, ModelCatalogEntry, ModelCredential, ThinkingLevel } from "@rakazo/contracts";
import { ThinkingLevelSchema, isMycelliosBaseUrl, OPENAI_COMPATIBLE_PROVIDER_ID } from "@rakazo/contracts";
import { chatModelChoices, connectedModelChoices, credentialForModel, modelOptionKey, parseModelOptionKey, resolveSelectableModelId } from "@rakazo/core";
import { Button, OptionSelect, Popover, PopoverContent, PopoverTrigger, Spinner, Switch } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Cpu } from "lucide-react";
import { useId, useRef, useState } from "react";
import { generalChatModel, selectableCatalogEntry, thinkingLevelLabel } from "../../lib/model-catalog";
import { useSpaceQueries, writeSaved } from "../../lib/query";
import { useSpaceRpc } from "../../lib/space-rpc";
import { errorText } from "../../lib/user-error";
import { enableCompatibleModel, savedModelIds } from "../model-settings/enable-compatible-model";
import { ChatModelPicker } from "./chat-model-picker";
import { ChatModelCatalog, type ChatModelCatalogSource } from "./chat-model-catalog";
import { ProviderLogo } from "../../components/ProviderLogo";
import { MycelliosProvider } from "../model-settings/mycellios-provider";

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
  const meQuery = useQuery({ ...queries.me.queryOptions(), enabled: Boolean(initialMe) });
  const me = meQuery.data ?? initialMe;
  const credentialsQuery = useQuery({ ...queries.models.credentials.queryOptions(), enabled: Boolean(me) });
  const catalogQuery = useQuery({ ...queries.models.list.queryOptions(), enabled: Boolean(me) });
  const enginesQuery = useQuery(queries.engines.list.queryOptions({ enabled: open }));
  const nativeCatalog = useQuery(queries.engines.codexModels.queryOptions({ enabled: open && (enginesQuery.data ?? []).some(engine => engine.id === "codex" && engine.available) }));
  const nativeModels = nativeCatalog.data ?? [];
  const nativeModel = nativeModels.find(model => bot.nativeConfig?.modelId ? model.id === bot.nativeConfig.modelId : model.isDefault);
  const credentials = credentialsQuery.data ?? EMPTY_CREDENTIALS;
  const mycelliosConnection = credentials.find(connection => isMycelliosBaseUrl(connection.baseUrl));
  const mycelliosCatalog = useQuery({
    queryKey: ["mycellios-chat-catalog", me?.userId, me?.spaceId, mycelliosConnection?.id],
    queryFn: ({ signal }) => rpc.models.mycelliosModels(undefined, { context: { spaceId: me!.spaceId }, signal }),
    enabled: (open || Boolean((bot.modelId ?? me?.defaultModel)?.startsWith("mycellios/"))) && Boolean(me && mycelliosConnection),
    staleTime: 60_000,
    retry: false,
    refetchInterval: query => query.state.data?.length === 0 ? 5_000 : false,
  });
  const catalog = [
    ...(catalogQuery.data ?? EMPTY_CATALOG).filter(entry => entry.providerName !== "Mycellios" && !entry.id.startsWith("mycellios/")),
    ...(mycelliosCatalog.data ?? []),
  ];
  const general = generalChatModel(me, catalog);
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
  const levels = nativeEngine === "codex" ? (nativeModel?.thinkingLevels ?? []).flatMap(level => { const parsed = ThinkingLevelSchema.safeParse(level); return parsed.success ? [parsed.data] : []; }) : nativeEngine ? [] : (credential?.thinkingLevels ?? entry?.thinkingLevels ?? []).filter(level => level !== "off");
  const value = nativeEngine ? modelOptionKey(`native-${nativeEngine}`, nativeEngine === "codex" ? bot.nativeConfig?.modelId ?? nativeModel?.id ?? "default" : "default")
    : bot.modelProvider && bot.modelId ? modelOptionKey(bot.modelProvider, resolveSelectableModelId(catalog, bot.modelProvider, bot.modelId)) : "";
  const sources = new Map<string, { provider: string }>();
  sources.set("Mycellios", { provider: OPENAI_COMPATIBLE_PROVIDER_ID });
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
  const currentProvider = nativeName ?? (model?.startsWith("mycellios/") || credential && isMycelliosBaseUrl(credential.baseUrl)
    ? "Mycellios" : connected.find((choice) => choice.key === (value || defaultKey))?.providerLabel ?? entry?.providerName ?? provider);
  // Installed account providers live beside API connections in the same picker.
  // OpenCode/ACP legacy selections stay visible, but new key connections never
  // ask the user to select the implementation that executes their model.
  const nativeProviders = [...new Set([
    ...(enginesQuery.data ?? []).filter(engine => engine.available && (engine.id === "codex" || engine.id === "claude")).map(engine => engine.id as NativeProvider),
    ...(nativeEngine ? [nativeEngine] : []),
  ])];
  const nativeChoices = nativeProviders.filter(engine => engine !== "codex" || !nativeModels.length).map(engine => ({
    key: modelOptionKey(`native-${engine}`, "default"), provider: `native-${engine}`,
    providerLabel: NATIVE_PROVIDERS[engine], label: NATIVE_PROVIDERS[engine] as string, title: t`Use this account`,
  }));
  if (nativeProviders.includes("codex")) nativeChoices.push(...nativeModels.map(model => ({
    key: modelOptionKey("native-codex", model.id), provider: "native-codex", providerLabel: NATIVE_PROVIDERS.codex, label: model.label, title: model.label,
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
  }), ...nativeChoices];
  const label = recovery ? t`Change model` : (nativeEngine === "codex" ? nativeModel?.label ?? bot.nativeConfig?.modelId ?? nativeName : nativeName) ?? connected.find(choice => choice.key === (value || defaultKey))?.title ?? entry?.label ?? (model?.startsWith("mycellios/") ? model.split("/").at(-1) : model) ?? (me?.needsModel ? t`Choose a model` : t`Model`);
  const headerEffort = ThinkingLevelSchema.safeParse(nativeEngine === "codex" ? bot.nativeConfig?.thinkingLevel ?? nativeModel?.defaultThinkingLevel : nativeEngine ? undefined : bot.thinkingLevel);
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
        fastMode: false, thinkingLevel: null } : null,
      modelProvider: engine ? null : selected?.provider ?? null,
      modelId: engine ? null : selected?.modelId ?? null,
      thinkingLevel: null,
      });
    });
  }
  return (
    <div className={recovery ? "ml-2 inline-flex" : "app-no-drag flex min-w-0 shrink-0 items-center gap-0.5"} data-testid={recovery ? "composer-error-model" : "chat-header-model"}>
      <Popover modal={recovery} open={open} onOpenChange={next => { if (!busy.current) { setOpen(next); setExploring(null); setLastProvider(null); setError(null); } }}>
        <PopoverTrigger type="button" title={label} data-mobile-chat-action={inMenu || undefined} aria-label={recovery ? label : t`Model`} className={recovery
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
                defaultKey={nativeEngine === "codex" ? modelOptionKey("native-codex", nativeModels.find(model => model.isDefault)?.id ?? "default") : defaultKey}
                inline={!recovery}
                onManage={() => { setOpen(false); onConnections(); }}
                onChange={choose}
                providerIds={Object.fromEntries([...sources].map(([name, source]) => [name, source.provider]))}
                initialProvider={lastProvider}
                onProviderChange={setLastProvider}
                catalogProviders={!recovery ? personalCatalogs.map(source => source.label) : undefined}
                onExplore={name => { setLastProvider(name); setExploring(name); setError(null); }}
                providerContent={name => name === "Mycellios" && !mycelliosConnection ? <ul><MycelliosProvider embedded onConnected={async () => {
                  await Promise.all([credentialsQuery.refetch(), catalogQuery.refetch(), queryClient.invalidateQueries({queryKey:queries.me.queryKey()})]);
                }} /></ul> : null}
                mycelliosCatalogReady={mycelliosCatalog.isSuccess}
                modelOrigins={Object.fromEntries((mycelliosCatalog.data ?? []).map(entry => [modelOptionKey(entry.provider, entry.id), entry.mycelliosProcessing === "external" ? "antseed" : "network"]))}
              />}
            </fieldset>}
          {mycelliosConnection && (!lastProvider || lastProvider === "Mycellios") && mycelliosCatalog.isFetching ? <p role="status" className="px-4 py-2 text-xs text-muted-foreground">{t`Loading models…`}</p> : null}
          {mycelliosConnection && (!lastProvider || lastProvider === "Mycellios") && mycelliosCatalog.isError ? <p role="alert" className="px-4 py-2 text-xs text-destructive">{t`Could not load the catalog.`} <Button size="sm" variant="ghost" onClick={() => void mycelliosCatalog.refetch()}>{t`Retry`}</Button></p> : null}
          {mycelliosConnection && (!lastProvider || lastProvider === "Mycellios") && mycelliosCatalog.data?.length === 0 ? <p role="status" className="px-4 py-2 text-xs text-muted-foreground">{t`No Mycellios agent models are available right now. Retrying automatically.`}</p> : null}
          {!recovery && (!lastProvider || lastProvider === currentProvider) && levels.length ? <label className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-4 py-3 text-sm">{t`Effort`}
            <OptionSelect
              aria-label={t`Thinking`}
              className="w-48 min-w-48 shrink-0"
              value={(nativeEngine === "codex" ? bot.nativeConfig?.thinkingLevel : bot.thinkingLevel) ?? ""}
              disabled={saving}
              options={[
                { value: "", label: t`Default` },
                ...levels.map((level) => ({ value: level, label: thinkingLevelLabel(level) })),
              ]}
              onValueChange={(value) => void save(() => onSave(nativeEngine === "codex"
                ? { agentEngine: "codex", modelProvider: null, modelId: null, thinkingLevel: null, nativeConfig: { ...bot.nativeConfig, thinkingLevel: (value || null) as ThinkingLevel | null } }
                : { modelProvider: bot.modelProvider, modelId: bot.modelId, thinkingLevel: (value || null) as ThinkingLevel | null }), false)}
            />
          </label> : null}
          {!recovery && (!lastProvider || lastProvider === currentProvider) && nativeEngine === "codex" && nativeModel?.fast ? <label className="flex items-center justify-between gap-3 px-4 pb-3 text-sm">
            <span title={t`Uses priority processing and may use more quota.`}>{t`Fast`}</span>
            <Switch aria-label={t`Fast`} checked={bot.nativeConfig?.fastMode === true} disabled={saving}
              onCheckedChange={fastMode => void save(() => onSave({ agentEngine: "codex", modelProvider: null, modelId: null, thinkingLevel: null, nativeConfig: { ...bot.nativeConfig, fastMode } }), false)} />
          </label> : null}
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

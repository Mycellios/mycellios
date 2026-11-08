import { useLingui } from "@lingui/react/macro";
import type { Bot, Me, ModelCatalogEntry, ModelCredential, ThinkingLevel } from "@rakazo/contracts";
import { isMycelliosBaseUrl, isOpenAiCompatibleProvider } from "@rakazo/contracts";
import { chatModelChoices, connectedModelChoices, credentialForModel, modelOptionKey, parseModelOptionKey, resolveSelectableModelId } from "@rakazo/core";
import { Button, OptionSelect, Popover, PopoverContent, PopoverTrigger, Spinner } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Cpu } from "lucide-react";
import { useId, useRef, useState } from "react";
import { generalChatModel, selectableCatalogEntry, thinkingLevelLabel } from "../../lib/model-catalog";
import { useSpaceQueries, writeSaved } from "../../lib/query";
import { useSpaceRpc } from "../../lib/space-rpc";
import { errorText } from "../../lib/user-error";
import { enableCompatibleModel, savedModelIds } from "../model-settings/enable-compatible-model";
import { ChatModelCatalog, type ChatModelCatalogSource } from "./chat-model-catalog";
import { ChatModelPicker } from "./chat-model-picker";

const EMPTY_CREDENTIALS: ModelCredential[] = [];
const EMPTY_CATALOG: ModelCatalogEntry[] = [];
export type ChatModelPatch = Pick<Bot, "modelProvider" | "modelId" | "thinkingLevel">;

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
  const [editingDefault, setEditingDefault] = useState(false);
  const [exploring, setExploring] = useState<string | null>(null);
  const [lastProvider, setLastProvider] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const rpc = useSpaceRpc();
  const meQuery = useQuery({ ...queries.me.queryOptions(), enabled: Boolean(initialMe) });
  const me = meQuery.data ?? initialMe;
  const credentialsQuery = useQuery({ ...queries.models.credentials.queryOptions(), enabled: open });
  const catalogQuery = useQuery({ ...queries.models.list.queryOptions(), enabled: open });
  const credentials = credentialsQuery.data ?? EMPTY_CREDENTIALS;
  const catalog = catalogQuery.data ?? EMPTY_CATALOG;
  const general = generalChatModel(me, catalog);
  const override = bot.modelProvider && bot.modelId
    ? { provider: bot.modelProvider, modelId: bot.modelId }
    : null;
  const provider = override?.provider ?? general?.provider;
  const model = override?.modelId ?? general?.modelId;
  const effectiveId = provider && model ? resolveSelectableModelId(catalog, provider, model) : null;
  const entry = provider && model ? selectableCatalogEntry(catalog, provider, model) : undefined;
  const credential = credentialForModel(credentials, provider ?? null, effectiveId ?? null);
  const levels = (credential?.thinkingLevels ?? entry?.thinkingLevels ?? []).filter(level => level !== "off");
  const value = bot.modelProvider && bot.modelId ? modelOptionKey(bot.modelProvider, resolveSelectableModelId(catalog, bot.modelProvider, bot.modelId)) : "";
  const inheritLabel = t`Use general model`;
  const sources = new Map<string, ChatModelCatalogSource>();
  const namedCredentials = credentials.map(connection => {
    const name = connectionName(connection);
    const label = sources.has(name) ? `${name} · ${connection.label}` : name;
    sources.set(label, { label, provider: connection.provider, connection, models: [] });
    return { ...connection, label };
  });
  const connected = connectedModelChoices(namedCredentials, catalog).map(choice => {
    const connection = credentialForModel(namedCredentials, choice.provider, choice.modelId)
      ?? namedCredentials.find(entry => entry.provider === choice.provider && entry.label === choice.providerLabel)
      ?? namedCredentials.find(entry => entry.provider === choice.provider);
    const label = connection?.label ?? choice.providerLabel ?? choice.provider;
    const source = sources.get(label) ?? { label, provider: choice.provider, models: [] };
    source.models.push({ id: choice.modelId, label: choice.modelLabel ?? choice.modelId });
    sources.set(label, source);
    return { ...choice, providerLabel: label, label: `${choice.modelLabel ?? choice.modelId} (${label})` };
  });
  const explorer = exploring ? sources.get(exploring) : undefined;
  const defaultKey = general ? modelOptionKey(general.provider, resolveSelectableModelId(catalog, general.provider, general.modelId)) : "";
  const currentProvider = connected.find((choice) => choice.key === (value || defaultKey))?.providerLabel
    ?? entry?.providerName ?? provider;
  const quickChoices = connected.filter(choice => {
    const source = sources.get(choice.providerLabel);
    return isOpenAiCompatibleProvider(choice.provider) || choice.key === value || choice.key === defaultKey ||
      (source?.connection?.modelId ? choice.modelId === source.connection.modelId : choice.modelId === source?.models[0]?.id);
  }).sort((left, right) => Number(right.key === (value || defaultKey)) - Number(left.key === (value || defaultKey)));
  const choices = editingDefault ? connected : chatModelChoices(
    recovery ? connected : quickChoices,
    value,
    general ? `${inheritLabel} · ${general.label}` : inheritLabel,
    general?.entry?.images,
  ).filter((choice) => choice.key || general || !me?.needsModel);
  const label = recovery ? t`Change model` : entry?.label ?? model ?? (me?.needsModel ? t`Choose a model` : t`Model`);
  const queryError = credentialsQuery.error ?? catalogQuery.error;

  async function save(apply: () => Promise<void>, close = true) {
    if (busy.current) return;
    busy.current = true; setSaving(true); setError(null);
    try {
      await apply();
      setExploring(null);
      if (close) { setOpen(false); setEditingDefault(false); }
    }
    catch (cause) { setError(errorText(cause)); }
    finally { busy.current = false; setSaving(false); }
  }

  function pickCatalog(modelId: string, use: boolean) {
    if (!explorer || !me) return;
    const source = explorer;
    void save(async () => {
      if (source.connection && isOpenAiCompatibleProvider(source.provider)) {
        const context = { spaceId: me.spaceId };
        const latest = await rpc.models.credentials(undefined, { context });
        const connection = latest.find(entry => entry.id === source.connection?.id);
        if (!connection || connection.baseUrl !== source.connection.baseUrl) {
          throw new Error(t`This connection has changed. Open the catalog again.`);
        }
        // A Mico saves provider + model. Do not claim a specific connection when two can serve the same ID.
        if (use && latest.some(entry => entry.id !== connection.id && entry.provider === connection.provider && savedModelIds(entry).includes(modelId))) {
          throw new Error(t`This model is already enabled on another connection. Use it from that connection.`);
        }
        const updated = await enableCompatibleModel(rpc, me.spaceId, connection, modelId, t`This connection has reached its enabled model limit.`);
        await writeSaved(queryClient, queries.models.credentials.queryKey(), () =>
          latest.map(entry => entry.id === updated.id ? {
            ...entry, modelId: entry.modelId ?? updated.modelId, enabledModelIds: updated.enabledModelIds,
          } : entry),
        );
      }
      if (use) await onSave({ modelProvider: source.provider, modelId, thinkingLevel: null });
    }, use);
  }

  function choose(key: string) {
    const selected = key ? parseModelOptionKey(key) : null;
    if (editingDefault) {
      if (!selected || !me) return;
      void save(async () => {
        await rpc.models.setRole(
          { role: "main", primary: selected, expectedUserId: me.userId },
          { context: { spaceId: me.spaceId } },
        );
        await queryClient.invalidateQueries({ queryKey: queries.me.queryKey() });
      });
    } else {
      void save(() => onSave({ modelProvider: selected?.provider ?? null, modelId: selected?.modelId ?? null, thinkingLevel: null }));
    }
  }
  return (
    <div className={recovery ? "ml-2 inline-flex" : "app-no-drag flex min-w-0 items-center gap-0.5"} data-testid={recovery ? "composer-error-model" : "chat-header-model"}>
      <Popover modal={recovery} open={open} onOpenChange={next => { if (!busy.current) { setOpen(next); setEditingDefault(false); setExploring(null); setLastProvider(null); setError(null); } }}>
        <PopoverTrigger type="button" data-mobile-chat-action={inMenu || undefined} aria-label={recovery ? label : t`Model`} className={recovery
          ? "inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:text-foreground"
          : "app-no-drag flex h-8 min-w-0 max-w-52 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"}>
          {inMenu ? <><Cpu aria-hidden /><span>{t`Model`}</span><span className="ms-auto min-w-0 truncate text-xs text-muted-foreground">{label}</span></> : (
            <><span className="truncate">{label}</span><ChevronDown size={12} className="shrink-0" /></>
          )}
        </PopoverTrigger>
        {open ? <PopoverContent align="end" className={recovery
          ? "app-no-drag w-80 max-w-[calc(100vw-24px)] gap-3 p-3"
          : "app-no-drag w-[364px] max-w-[calc(100vw-24px)] max-h-(--available-height) gap-0 overflow-y-auto p-0"}>
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
                key={String(editingDefault)}
                id={`${id}-model`}
                choices={choices}
                value={editingDefault ? defaultKey : value}
                defaultKey={defaultKey}
                currentProvider={editingDefault ? undefined : currentProvider}
                inline={!recovery}
                onManage={() => { setOpen(false); setEditingDefault(false); onConnections(); }}
                onChange={choose}
                heading={editingDefault ? t`Choose the general model` : undefined}
                catalogProviders={!editingDefault && !recovery && me ? [...sources.keys()] : undefined}
                initialProvider={editingDefault ? undefined : lastProvider}
                onExplore={name => { setLastProvider(name); setExploring(name); setError(null); }}
              />}
            </fieldset>}
          {!recovery && !editingDefault && !explorer && levels.length ? <label className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-xs">{t`Thinking`}
            <OptionSelect
              aria-label={t`Thinking`}
              className="w-32"
              value={bot.thinkingLevel ?? ""}
              disabled={saving}
              options={[
                { value: "", label: t`Default` },
                ...levels.map((level) => ({ value: level, label: thinkingLevelLabel(level) })),
              ]}
              onValueChange={(value) => void save(() => onSave({ modelProvider: bot.modelProvider, modelId: bot.modelId, thinkingLevel: (value || null) as ThinkingLevel | null }))}
            />
          </label> : null}
          {saving ? <Spinner aria-label={t`Saving…`} className="mx-auto my-2 text-muted-foreground" /> : null}
          {error ? <p role="alert" className="p-2 text-xs text-destructive">{error}</p> : null}
          {explorer ? null : recovery || !sources.size ? (
            <Button variant="ghost" size="sm" onClick={() => { setOpen(false); onConnections(); }}>{t`Manage models`}</Button>
          ) : me ? (
            <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
              {editingDefault ? <span className="text-xs text-muted-foreground">{t`For Micos using the general model`}</span> : null}
              <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => { setEditingDefault(!editingDefault); setError(null); }}>
                {editingDefault ? t`Back` : t`Change general model`}
              </Button>
            </div>
          ) : null}
        </PopoverContent> : null}
      </Popover>
      {!recovery && bot.thinkingLevel ? <span className="hidden shrink-0 text-xs text-muted-foreground xl:inline">· {thinkingLevelLabel(bot.thinkingLevel)}</span> : null}
    </div>
  );
}

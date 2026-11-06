import { useLingui } from "@lingui/react/macro";
import type { Bot, Me, ModelCatalogEntry, ModelCredential, ThinkingLevel } from "@rakazo/contracts";
import { chatModelChoices, connectedModelChoices, credentialForModel, modelOptionKey, parseModelOptionKey, resolveSelectableModelId } from "@rakazo/core";
import { Button, NativeSelect, NativeSelectOption, Popover, PopoverContent, PopoverTrigger, Spinner } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useId, useRef, useState } from "react";
import { thinkingLevelLabel } from "../../lib/model-catalog";
import { useSpaceQueries } from "../../lib/query";
import { errorText } from "../../lib/user-error";
import { useCompatibleRoleCatalog } from "../model-settings/use-compatible-role-catalog";
import { ChatModelPicker } from "./chat-model-picker";

const EMPTY_CREDENTIALS: ModelCredential[] = [];
const EMPTY_CATALOG: ModelCatalogEntry[] = [];
export type ChatModelPatch = Pick<Bot, "modelProvider" | "modelId" | "thinkingLevel">;

export function ChatHeaderModel({ bot, me, onSave, onConnections }: {
  bot: Bot;
  me: Me | null | undefined;
  onSave: (patch: ChatModelPatch) => Promise<void>;
  onConnections: () => void;
}) {
  const { t } = useLingui();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const queries = useSpaceQueries();
  const credentialsQuery = useQuery({ ...queries.models.credentials.queryOptions(), enabled: open });
  const catalogQuery = useQuery({ ...queries.models.list.queryOptions(), enabled: open });
  const credentials = credentialsQuery.data ?? EMPTY_CREDENTIALS;
  const catalog = catalogQuery.data ?? EMPTY_CATALOG;
  const network = useCompatibleRoleCatalog(credentials, me?.userId ?? "", me?.spaceId ?? "", open && Boolean(me), true);
  const provider = bot.modelProvider ?? me?.defaultProvider;
  const model = bot.modelId ?? me?.defaultModel;
  const effectiveId = provider && model ? resolveSelectableModelId(catalog, provider, model) : model;
  const entry = catalog.find(item => item.provider === provider && resolveSelectableModelId(catalog, item.provider, item.id) === effectiveId);
  const credential = credentialForModel(credentials, provider ?? null, effectiveId ?? null);
  const levels = (credential?.thinkingLevels ?? entry?.thinkingLevels ?? []).filter(level => level !== "off");
  const value = bot.modelProvider && bot.modelId ? modelOptionKey(bot.modelProvider, resolveSelectableModelId(catalog, bot.modelProvider, bot.modelId)) : "";
  const choices = chatModelChoices(connectedModelChoices(network.credentials, catalog), value, t`Use general model`, entry?.images);
  const label = entry?.label ?? model ?? t`Model`;
  const queryError = credentialsQuery.error ?? catalogQuery.error;

  async function save(patch: ChatModelPatch) {
    if (busy.current) return;
    busy.current = true; setSaving(true); setError(null);
    try { await onSave(patch); setOpen(false); }
    catch (cause) { setError(errorText(cause)); }
    finally { busy.current = false; setSaving(false); }
  }
  return (
    <div className="app-no-drag flex min-w-0 items-center gap-0.5" data-testid="chat-header-model">
      <Popover open={open} onOpenChange={next => { if (!busy.current) { setOpen(next); setError(null); } }}>
        <PopoverTrigger aria-label={t`Model`} className="app-no-drag flex h-8 min-w-0 max-w-52 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <span className="truncate">{label}</span><ChevronDown size={12} className="shrink-0" />
        </PopoverTrigger>
        {open ? <PopoverContent align="end" className="app-no-drag w-80 max-w-[calc(100vw-24px)] gap-3 p-3">
          <label htmlFor={`${id}-model`} className="text-xs font-medium">{t`Model`}</label>
          {credentialsQuery.isPending || catalogQuery.isPending ? <Spinner className="size-4" /> : queryError ? <p role="alert" className="text-xs text-destructive">{errorText(queryError)}</p> :
            <fieldset disabled={saving} className="min-w-0 [&>div]:mt-0 [&>button]:mt-0">
              <ChatModelPicker id={`${id}-model`} choices={choices} value={value} onChange={key => {
                const selected = key ? parseModelOptionKey(key) : null;
                void save({ modelProvider: selected?.provider ?? null, modelId: selected?.modelId ?? null, thinkingLevel: null });
              }} />
            </fieldset>}
          {levels.length ? <label className="flex items-center justify-between gap-3 text-xs">{t`Thinking`}
            <NativeSelect aria-label={t`Thinking`} value={bot.thinkingLevel ?? ""} disabled={saving} onChange={event => void save({ modelProvider: bot.modelProvider, modelId: bot.modelId, thinkingLevel: (event.target.value || null) as ThinkingLevel | null })}>
              <NativeSelectOption value="">{t`Default`}</NativeSelectOption>
              {levels.map(level => <NativeSelectOption key={level} value={level}>{thinkingLevelLabel(level)}</NativeSelectOption>)}
            </NativeSelect>
          </label> : null}
          {saving ? <Spinner className="size-4" /> : null}
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
          <Button variant="ghost" size="sm" onClick={() => { setOpen(false); onConnections(); }}>{t`Manage models`}</Button>
        </PopoverContent> : null}
      </Popover>
      {bot.thinkingLevel ? <span className="hidden shrink-0 text-xs text-muted-foreground xl:inline">· {thinkingLevelLabel(bot.thinkingLevel)}</span> : null}
    </div>
  );
}

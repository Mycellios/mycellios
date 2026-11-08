import { useLingui } from "@lingui/react/macro";
import { isOpenAiCompatibleProvider, type ModelCredential } from "@rakazo/contracts";
import { matchesSearchQuery } from "@rakazo/core";
import { Button, Input, Spinner } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Search } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { useSpaceRpc } from "../../lib/space-rpc";
import { classifyModelConnectionFailure } from "../../lib/model-connection-preflight";
import { savedModelIds } from "../model-settings/enable-compatible-model";
import { compatibleRoleCatalogKey, discoverCompatibleModels } from "../model-settings/use-compatible-role-catalog";

export type ChatModelCatalogSource = {
  label: string;
  provider: string;
  connection?: ModelCredential;
  models: { id: string; label: string }[];
};

const PAGE_SIZE = 40;

export function ChatModelCatalog({ source, userId, spaceId, onBack, onPick }: {
  source: ChatModelCatalogSource;
  userId: string;
  spaceId: string;
  onBack: () => void;
  onPick: (modelId: string, use: boolean) => void;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search);
  const [selected, setSelected] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const { connection } = source;
  const remote = Boolean(connection?.baseUrl && isOpenAiCompatibleProvider(connection.provider));
  const modelQuery = useQuery({
    queryKey: compatibleRoleCatalogKey(userId, spaceId, connection?.id ?? "", connection?.baseUrl ?? ""),
    queryFn: ({ signal }) => discoverCompatibleModels(rpc, connection!, spaceId, signal),
    enabled: remote,
    staleTime: 60_000,
    retry: false,
  });
  const failure = modelQuery.isError ? classifyModelConnectionFailure(modelQuery.error) : null;
  const enabled = new Set(connection ? savedModelIds(connection) : []);
  const models = remote ? [...new Set(modelQuery.data?.models ?? [])].map(id => ({ id, label: id })) : source.models;
  const results = query.trim() ? models.filter(model => matchesSearchQuery(query, model.id, model.label)) : models;
  const picked = results.find(model => model.id === selected);
  const needsEnable = Boolean(picked && remote && !enabled.has(picked.id));

  return (
    <div className="min-w-0 space-y-2 p-2">
      <div className="flex min-w-0 items-center gap-2">
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t`Back`} onClick={onBack}><ArrowLeft aria-hidden /></Button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{source.label}</p>
          <p className="text-xs text-muted-foreground">{t`Model catalog`}</p>
        </div>
      </div>
      <div className="relative">
        <Search size={14} aria-hidden className="pointer-events-none absolute start-2.5 top-2.5 text-muted-foreground" />
        <Input className="ps-8" value={search} aria-label={t`Search catalog`} placeholder={t`Search catalog`} onChange={event => {
          setSearch(event.target.value);
          setLimit(PAGE_SIZE);
        }} />
      </div>
      {remote && modelQuery.isPending ? <Spinner className="m-2 size-4" /> :
        remote && failure && !modelQuery.data ? (
          <div className="space-y-1 px-2 text-xs">
            <p role="alert" className="break-words">{t`Could not load the catalog.`} {failure.message}</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => void modelQuery.refetch()}>{t`Retry`}</Button>
          </div>
        ) : remote && !models.length ? (
          <div className="space-y-1 px-2 text-xs">
            <p role="status">{t`This connection returned no models in its catalog.`}</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => void modelQuery.refetch()}>{t`Retry`}</Button>
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto" role="group" aria-label={t`Model catalog`}>
            {!results.length ? <p role="status" className="p-2 text-xs text-muted-foreground">{t`No matching models`}</p> : null}
            {results.slice(0, limit).map(model => (
              <Button key={model.id} type="button" size="sm" variant={selected === model.id ? "secondary" : "ghost"}
                className="w-full justify-start font-normal" title={model.label} aria-pressed={selected === model.id}
                onClick={() => setSelected(model.id)}>
                <span className="min-w-0 flex-1 truncate text-start">{model.label}</span>
                {enabled.has(model.id) ? <Check aria-label={t`Enabled`} className="size-3.5 text-muted-foreground" /> : null}
              </Button>
            ))}
            {results.length > limit ? <Button type="button" size="sm" variant="ghost" onClick={() => setLimit(limit + PAGE_SIZE)}>{t`Show more`}</Button> : null}
          </div>
        )}
      {picked ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-2">
          {needsEnable ? <Button type="button" size="sm" variant="outline" onClick={() => onPick(picked.id, false)}>{t`Enable`}</Button> : null}
          <Button type="button" size="sm" onClick={() => onPick(picked.id, true)}>{needsEnable ? t`Enable and use` : t`Use model`}</Button>
        </div>
      ) : null}
    </div>
  );
}

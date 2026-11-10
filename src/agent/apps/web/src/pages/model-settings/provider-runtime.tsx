import { useLingui } from "@lingui/react/macro";
import { matchesSearchQuery } from "@rakazo/core";
import { Button, Input } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import type { RpcClient } from "../../lib/rpc";
import { useSpaceRpc } from "../../lib/space-rpc";
import { LocalModelDiscovery } from "./local-model-discovery";

export type ProviderRuntime = Awaited<ReturnType<RpcClient["engines"]["list"]>>[number];

export function useProviderRuntimes(enabled: boolean) {
  const rpc = useSpaceRpc();
  const queries = useSpaceQueries();
  const engines = useQuery(queries.engines.list.queryOptions({ enabled }));
  const [installing, setInstalling] = useState(false);
  const [installFailed, setInstallFailed] = useState(false);

  async function installOpenCode() {
    if (installing || !engines.data?.some((engine) => engine.id === "opencode" && engine.canInstall)) return;
    setInstalling(true);
    setInstallFailed(false);
    try {
      await rpc.engines.installOpenCode();
      const result = await engines.refetch();
      setInstallFailed(!result.data?.some((engine) => engine.id === "opencode" && engine.available));
    } catch {
      const result = await engines.refetch();
      setInstallFailed(!result.data?.some((engine) => engine.id === "opencode" && engine.managedVersion));
    } finally {
      setInstalling(false);
    }
  }
  return { engines, installing, installFailed, installOpenCode };
}

export function ProviderRuntimeDetails({ runtime }: { runtime: ProviderRuntime }) {
  const { t } = useLingui();
  return (
    <div className="space-y-2 ps-7 text-sm text-muted-foreground">
      <p>{runtime.available ? t`Select this provider from the model menu in your chat.`
        : t`A server administrator must configure this agent engine before it can be used.`}</p>
    </div>
  );
}

export function ProviderDiscovery({ host, onSelect, disabled }: {
  host: ReturnType<typeof useProviderRuntimes>;
  onSelect: (baseUrl: string, modelId?: string) => void;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const registry = useQuery(queries.engines.registry.queryOptions({ enabled: false, staleTime: 5 * 60_000 }));
  const [search, setSearch] = useState("");
  const native = host.engines.data?.filter((engine) => engine.id === "codex" || engine.id === "claude") ?? [];
  const matches = registry.data?.filter((agent) => !search.trim() || matchesSearchQuery(search, agent.name, agent.id, agent.description));
  return (
    <div className="space-y-6" data-testid="provider-discovery">
      {native.length || host.engines.isError ? (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{t`Found on this server`}</h3>
            <Button type="button" variant="ghost" size="sm" disabled={host.engines.isFetching || host.installing}
              onClick={() => void host.engines.refetch()}>
              <RefreshCw aria-hidden /> {t`Scan again`}
            </Button>
          </div>
          {host.engines.isError ? <p role="alert" className="text-sm text-destructive">{t`Could not check the server’s agent engines.`}</p>
            : <p className="text-sm text-muted-foreground">{native.filter((engine) => engine.available).map((engine) => engine.name).join(", ") || t`No native agents found on this server.`}</p>}
          <p className="text-sm text-muted-foreground">{t`The server administrator manages custom ACP agents in the host configuration.`}</p>
        </section>
      ) : null}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t`ACP Registry`}</h3>
        <p className="text-sm text-muted-foreground">{t`Browse agent engines compatible with the Agent Client Protocol.`}</p>
        <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => {
          event.preventDefault();
          if (!registry.data) void registry.refetch();
        }}>
          <Input className="min-w-0 flex-1" type="search" aria-label={t`Search the ACP Registry`}
            placeholder={t`Search the ACP Registry`} value={search} onChange={(event) => setSearch(event.target.value)} />
          {!registry.data ? <Button type="submit" variant="outline" size="sm" disabled={registry.isFetching}>
            {registry.isFetching ? t`Searching…` : registry.isError ? t`Retry` : t`Search`}
          </Button> : null}
        </form>
        {registry.isError ? <p role="alert" className="text-sm text-destructive">{t`Could not load the ACP Registry.`}</p> : null}
        {matches?.length ? <ul className="rk-scroll max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border">
          {matches.map((agent) => <li key={agent.id} className="px-3 py-2">
            <p className="text-sm font-medium">{agent.name} <span className="text-xs text-muted-foreground">{agent.version}</span></p>
            {agent.description ? <p className="break-words text-xs text-muted-foreground">{agent.description}</p> : null}
          </li>)}
        </ul> : matches ? <p role="status" className="text-sm text-muted-foreground">{t`No results`}</p> : null}
        <a href="https://agentclientprotocol.com/registry" target="_blank" rel="noopener noreferrer"
          className="inline-block text-sm underline underline-offset-4">
          {t`Browse ACP Registry`}
        </a>
      </section>
      {native.length ? <section>
        <h3 className="text-sm font-medium">{t`Local discovery`}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t`Find Ollama and LM Studio on the computer running this server. Use Custom provider for other addresses.`}</p>
        <LocalModelDiscovery onSelect={onSelect} disabled={disabled} />
      </section> : null}
    </div>
  );
}

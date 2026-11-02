import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { useState } from "react";
import { useSpaceRpc } from "../../lib/space-rpc";

export function LocalModelDiscovery({
  onSelect,
  disabled,
}: {
  onSelect: (baseUrl: string, modelId?: string) => void;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const [servers, setServers] = useState<Array<{
    name: string;
    baseUrl: string;
    modelIds: string[];
  }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function discover() {
    setBusy(true);
    setError("");
    try {
      setServers(await rpc.models.discoverLocal());
    } catch {
      setError(
        t`Local discovery is available to the server owner on the computer running the server.`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2 space-y-2">
      <Button variant="ghost" size="sm" disabled={disabled || busy} onClick={() => void discover()}>
        {busy ? <Trans>Searching…</Trans> : <Trans>Find local servers</Trans>}
      </Button>
      {servers?.map((server) => (
        <div key={server.baseUrl} className="flex flex-wrap items-center gap-2 text-sm">
          <span>{server.name}</span>
          {server.modelIds.length ? (
            server.modelIds.map((modelId) => (
              <Button
                key={modelId}
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onSelect(server.baseUrl, modelId)}
              >
                {modelId}
              </Button>
            ))
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onSelect(server.baseUrl)}
            >
              <Trans>Use server</Trans>
            </Button>
          )}
        </div>
      ))}
      {servers?.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          <Trans>No local servers found on the computer running the server.</Trans>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

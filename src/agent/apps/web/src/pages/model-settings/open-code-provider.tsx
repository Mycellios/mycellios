import { useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { SquareTerminal } from "lucide-react";
import type { ReactNode } from "react";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { ProviderDetail } from "./provider-detail";
import type { useProviderRuntimes } from "./provider-runtime";
import type { ConnectableProvider } from "./role-model-picker";

export function OpenCodeProvider({
  host, connections, onManage, onBack, connectionPanel, disabled,
}: {
  host: ReturnType<typeof useProviderRuntimes>;
  connections: readonly (ConnectableProvider & { credentialId?: string })[];
  onManage: (connection: ConnectableProvider & { credentialId?: string }) => void;
  onBack: () => void;
  connectionPanel?: ReactNode;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const runtime = host.engines.data?.find((engine) => engine.id === "opencode");
  const status = host.engines.isError ? t`Could not check the server’s agent engines.`
    : runtime?.available ? t`Available on this server`
      : host.engines.isPending ? t`Checking availability…`
        : runtime ? t`Not installed` : t`OpenCode is unavailable for this space.`;
  return (
    <ProviderDetail integration="opencode" name="OpenCode" description={t`Built-in agent engine`}
      status={runtime?.available ? t`Available on this server` : runtime?.canInstall ? t`Download available` : t`Not available`}
      connected={runtime?.available === true} icon={<SquareTerminal aria-hidden className="size-5" />}
      onBack={onBack} disabled={disabled}>
      <SettingsGroup title={t`Runtime`}>
        <SettingsRow label={<><p className="font-medium">OpenCode</p><p className="text-sm text-muted-foreground">{status}</p></>}
          control={<Button type="button" variant="outline" size="sm" disabled={host.engines.isFetching || host.installing}
            onClick={() => void host.engines.refetch()}>{t`Check availability`}</Button>}>
          {runtime?.managedVersion ? <p className="text-sm text-muted-foreground">{t`Version ${runtime.managedVersion} · Downloaded by Mycellios`}</p> : null}
        </SettingsRow>
        {runtime?.canInstall && !runtime.available ? (
          <SettingsRow label={t`Download OpenCode to use it on this server.`}
            control={<Button type="button" size="sm" disabled={host.installing || disabled} onClick={() => void host.installOpenCode()}>
              {host.installing ? t`Downloading…` : t`Download`}
            </Button>}>
            {host.installFailed ? <p role="alert" className="text-sm text-destructive">{t`Could not install OpenCode. Try again.`}</p> : null}
          </SettingsRow>
        ) : null}
      </SettingsGroup>
      <SettingsGroup title={t`Use`}>
        <SettingsRow label={<>
          <p className="font-medium">{t`Agent engine`}</p>
          <p className="text-sm text-muted-foreground">{t`Choose OpenCode in the Mico’s Agent engine settings.`}</p>
          <p className="text-sm text-muted-foreground">{t`Uses OpenCode in an isolated profile without your local sign-in.`}</p>
        </>} />
      </SettingsGroup>
      {connections.length ? <SettingsGroup title={t`Model API connections`}>
        <p className="px-4 py-3 text-sm text-muted-foreground">{t`Zen and Go use separate API credentials for model requests.`}</p>
        {connections.map((connection) => <SettingsRow key={connection.id} label={connection.name}
          control={<Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onManage(connection)}>
            {connection.credentialId ? t`Manage connection` : t`Add key`}
          </Button>} />)}
        {connectionPanel ? <div className="p-3">{connectionPanel}</div> : null}
      </SettingsGroup> : null}
    </ProviderDetail>
  );
}

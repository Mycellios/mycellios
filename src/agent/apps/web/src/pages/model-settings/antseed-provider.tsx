import { useLingui } from "@lingui/react/macro";
import type { ModelCredential } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { Network, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { savedModelIds } from "./enable-compatible-model";
import { ProviderDetail } from "./provider-detail";

function gatewayHost(baseUrl?: string) {
  try { return baseUrl ? new URL(baseUrl).host : null; }
  catch { return null; }
}

export function AntSeedProvider({ credentials, nameOf, onBack, onManage, connectionPanel, disabled }: {
  credentials: readonly ModelCredential[];
  nameOf: (credential: ModelCredential) => string;
  onBack: () => void;
  onManage: (credential?: ModelCredential) => void;
  connectionPanel?: ReactNode;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const connected = credentials.some((credential) => credential.hasKey);
  return (
    <ProviderDetail integration="antseed" name="AntSeed" description={t`Model provider through your AntSeed gateway`}
      status={connected ? t`Connected` : t`Not connected`} connected={connected}
      icon={<Network aria-hidden className="size-5" />} onBack={onBack} disabled={disabled}>
      <SettingsGroup title={t`Connections`}>
        {credentials.map((credential) => {
          const gateway = gatewayHost(credential.baseUrl);
          const modelCount = savedModelIds(credential).length;
          return <SettingsRow key={credential.id} label={<>
            <p className="font-medium">{nameOf(credential)}</p>
            <p className="text-sm text-muted-foreground">
              {gateway ? <>{gateway} · </> : null}
              {t`${modelCount} models enabled`}
            </p>
          </>} control={<Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onManage(credential)}>
            {t`Manage connection`}
          </Button>} />;
        })}
        <SettingsRow label={<>
          <p className="font-medium">{t`AntSeed gateway`}</p>
          <p className="text-sm text-muted-foreground">{t`Use your own gateway URL and API key.`}</p>
        </>} control={<Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onManage()}>
          <Plus aria-hidden /> {t`Add connection`}
        </Button>} />
        {connectionPanel ? <div className="px-4 pb-4">{connectionPanel}</div> : null}
      </SettingsGroup>
      <SettingsGroup title={t`Use`}>
        <SettingsRow label={<>
          <p className="font-medium">{t`Choose a model in your Mico’s model picker.`}</p>
          <p className="text-sm text-muted-foreground">{t`Your AntSeed gateway manages its own balance and spending limits.`}</p>
        </>} control={<a href="https://antseed.com/docs/gateway/" target="_blank" rel="noopener noreferrer"
          className="text-sm underline underline-offset-4">{t`Gateway guide`}</a>} />
      </SettingsGroup>
    </ProviderDetail>
  );
}

import { useLingui } from "@lingui/react/macro";
import type { SpaceSetting } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import type { QueryKey } from "@tanstack/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { ApprovalRulesSettings } from "../components/ApprovalRulesSettings";
import { SettingsGroup, SettingsRow } from "../components/SettingsRows";
import { useSpaceQueries, writeSaved } from "../lib/query";
import { useSpaceRpc } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";
import { ModelSettingsOverlay } from "./ModelSettingsOverlay";
import { VoiceSettingsOverlay } from "./VoiceSettingsOverlay";
import { useProviderRuntimes } from "./model-settings/provider-runtime";

/**
 * Account settings the bound Space follows until the member customizes them here. A customized
 * setting shows the same panel as the account's section, editing the Space's own copy.
 */
export function SpaceSettingOverrides({
  setting,
  onClose,
  onBusyChange,
  onFormStateChange,
  onRequestLeave,
}: {
  setting: SpaceSetting;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
  onFormStateChange?: (state: { busy: boolean; dirty: boolean }) => void;
  onRequestLeave: (next: () => void) => void;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const overrides = useQuery(queries.spaceSettings.overrides.queryOptions());
  const { engines, installing: installingOpenCode, installFailed: installError, installOpenCode } =
    useProviderRuntimes(setting === "models");
  const openCode = engines.data?.find((engine) => engine.id === "opencode");
  const [pending, setPending] = useState<SpaceSetting | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const settings: { id: SpaceSetting; label: string; panel: () => ReactNode }[] = [
    {
      id: "models",
      label: t`Models`,
      panel: () => (
        <ModelSettingsOverlay
          embedded
          scope="space"
          onClose={onClose}
          onFormStateChange={onFormStateChange}
          onRequestLeave={onRequestLeave}
        />
      ),
    },
    {
      id: "voice",
      label: t`Voice`,
      panel: () => (
        <VoiceSettingsOverlay
          embedded
          scope="space"
          onClose={onClose}
          onBusyChange={onBusyChange}
          onFormStateChange={onFormStateChange}
        />
      ),
    },
    {
      id: "confirmations",
      label: t`Approvals`,
      panel: () => <ApprovalRulesSettings scope="space" />,
    },
  ];

  async function setOverride(setting: SpaceSetting, enabled: boolean) {
    if (pending) return;
    setPending(setting);
    setActionError(null);
    try {
      const next = await rpc.spaceSettings.setOverride({ setting, enabled });
      await writeSaved(queryClient, queries.spaceSettings.overrides.queryKey(), () => next);
      // Reads that omit a scope get whichever copy applies, so they change with the override.
      const affected: Record<SpaceSetting, QueryKey[]> = {
        models: [queries.models.key(), queries.me.key()],
        voice: [queries.voice.key()],
        confirmations: [queries.approvalRules.key(), queries.autoReview.key()],
      };
      for (const queryKey of affected[setting]) void queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setPending(null);
    }
  }

  if (overrides.data === undefined) {
    return overrides.isError ? (
      <div role="alert" className="text-[12.5px] text-destructive">
        {errorText(overrides.error)}
        <Button variant="ghost" size="sm" onClick={() => void overrides.refetch()}>
          {t`Retry`}
        </Button>
      </div>
    ) : null;
  }
  const customized = overrides.data;

  return (
    <div className="space-y-3">
      {setting === "models" ? (
        <SettingsGroup>
          <SettingsRow
            label={
              <>
                <p>OpenCode</p>
                {openCode?.managedVersion ? (
                  <p className="text-[13px] text-muted-foreground">
                    {t`Version ${openCode.managedVersion} · Downloaded by Mycellios`}
                  </p>
                ) : null}
                <p className="text-[13px] text-muted-foreground">
                  {openCode?.available
                    ? t`Available in each Mico’s Agent engine settings.`
                    : engines.isPending
                      ? t`Loading…`
                      : openCode?.canInstall
                        ? t`Download OpenCode to use it on this server.`
                        : t`OpenCode is unavailable for this space.`}
                </p>
              </>
            }
            control={openCode?.canInstall ? (
              <Button variant="outline" size="sm" disabled={installingOpenCode} onClick={() => void installOpenCode()}>
                {installingOpenCode ? t`Downloading…` : t`Download`}
              </Button>
            ) : null}
          />
          {installError ? (
            <p role="alert" className="px-4 pb-3 text-sm text-destructive">
              {t`Could not install OpenCode. Try again.`}
            </p>
          ) : null}
        </SettingsGroup>
      ) : null}
      <SettingsGroup data-testid="space-setting-overrides">
        {settings.filter(({ id }) => id === setting).map(({ id, label, panel }) => {
          const custom = customized.includes(id);
          return (
            <div key={id} data-testid={`space-setting-${id}`}>
              <SettingsRow
                help={{ label, description: t`Customize changes this setting only for this space. Use defaults makes it follow your account settings again.` }}
                label={
                  <>
                    <p>{label}</p>
                    {custom ? null : (
                      <p className="text-[13px] text-muted-foreground">{t`Your defaults`}</p>
                    )}
                  </>
                }
                control={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-full"
                    aria-label={custom ? t`Use defaults for ${label}` : t`Customize ${label}`}
                    disabled={pending !== null}
                    onClick={() => onRequestLeave(() => void setOverride(id, !custom))}
                  >
                    {custom ? t`Use defaults` : t`Customize`}
                  </Button>
                }
              >
                {custom ? <div className="pt-3">{panel()}</div> : null}
              </SettingsRow>
            </div>
          );
        })}
      </SettingsGroup>
      {actionError ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {actionError}
        </p>
      ) : null}
    </div>
  );
}

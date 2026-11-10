import { DeviceVoiceSettings } from "./DeviceVoiceSettings";
import { useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import { BotAvatar, Button, OptionSelect } from "@rakazo/ui-web";
import { useState } from "react";
import { MobileInstallOffer, mobileInstallUrl } from "../../components/MobileInstallOffer";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { SkillLibrarySettings } from "../SkillLibrarySettings";
import { setGeneralPreferences, useGeneralPreferences } from "../../lib/general-preferences";

export function MicosSettingsPanel({
  bots = [],
  onOpen,
  onModels,
}: {
  bots?: Bot[];
  onOpen?: (id: string) => void;
  onSkills?: () => void;
  onModels?: () => void;
}) {
  const { t } = useLingui();
  const value = useGeneralPreferences(); const [error, setError] = useState("");
  return (
    <div className="rk-settings-panel space-y-6">
      <SettingsGroup title={t`Preferences`}>
        <SettingsRow label={t`Models and connections`} description={t`Choose a provider once. Your Micos use it automatically.`}
          control={<Button variant="outline" size="sm" disabled={!onModels} onClick={onModels}>{t`Manage`}</Button>} />
        <SettingsRow label={t`Messages while a Mico works`} description={t`Choose the usual behavior. You can change it before sending a message.`}
          control={<OptionSelect aria-label={t`Messages while a Mico works`} value={value.busyMessageMode}
            className="w-48 max-w-full" options={[{ value: "queue", label: t`Next turn` }, { value: "steer", label: t`Current task` }]}
            onValueChange={busyMessageMode => { try { setGeneralPreferences({ busyMessageMode: busyMessageMode as "queue" | "steer" }); setError(""); } catch { setError(t`Could not save this preference.`); } }} />} />
      </SettingsGroup>
      <SettingsGroup title={t`Your Micos`}>
        {bots.length ? (
          bots.map((bot) => (
            <SettingsRow
              key={bot.id}
              label={<span className="flex items-center gap-3"><BotAvatar color={bot.color} size={28} />{bot.name}</span>}
              control={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!onOpen}
                  onClick={() => onOpen?.(bot.id)}
                >{t`Manage`}</Button>
              }
            />
          ))
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">{t`No Micos in this space.`}</p>
        )}
      </SettingsGroup>
      <SkillLibrarySettings />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
export function MobileSettingsPanel() {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState("");
  const url = mobileInstallUrl(window.location.origin);
  const localOnly = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopy(t`Link copied`);
    } catch {
      setCopy(t`Could not copy. Open the link above or type it on your phone.`);
    }
  }
  return (
    <div className="rk-settings-panel space-y-6">
      <SettingsGroup title={t`Mycellios on your phone`}>
        <SettingsRow
          label={localOnly ? t`Local preview` : t`Use your existing account`}
          description={localOnly ? t`This address only opens on this computer. Use a reachable server address to connect a phone.` : t`Open Mycellios on your phone, sign in and add it to your Home Screen.`}
          control={
            <Button variant="outline" onClick={() => setOpen(true)}>{t`How to install`}</Button>
          }
        />
        {!localOnly && <SettingsRow
          label={
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-sm underline underline-offset-4"
            >
              {url}
            </a>
          }
          control={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void copyLink()}
            >{t`Copy link`}</Button>
          }
        />}
      </SettingsGroup>
      {copy ? (
        <p role="status" className="text-sm text-muted-foreground">
          {copy}
        </p>
      ) : null}
      <MobileInstallOffer mini open={open} onOpenChange={setOpen} />
    </div>
  );
}

export function VoiceEntryPanel({ onOpen }: { onOpen?: () => void }) {
  const { t } = useLingui();
  return (
    <div className="rk-general-settings mb-6">
      <DeviceVoiceSettings />
      {onOpen && <SettingsGroup title={t`Voice conversation`}>
        <SettingsRow
          label={t`Talk with your Mico`}
          control={
            <Button variant="outline" disabled={!onOpen} onClick={onOpen}>{t`Open voice`}</Button>
          }
        />
      </SettingsGroup>}
    </div>
  );
}

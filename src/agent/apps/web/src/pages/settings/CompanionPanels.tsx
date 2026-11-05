import { useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { useState } from "react";
import { MobileInstallOffer, mobileInstallUrl } from "../../components/MobileInstallOffer";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { SkillLibrarySettings } from "../SkillLibrarySettings";

export function MicosSettingsPanel({
  bots = [],
  onOpen,
}: {
  bots?: Bot[];
  onOpen?: (id: string) => void;
  onSkills?: () => void;
}) {
  const { t } = useLingui();
  return (
    <div className="space-y-6">
      <SettingsGroup title={t`Your Micos`}>
        {bots.length ? (
          bots.map((bot) => (
            <SettingsRow
              key={bot.id}
              label={bot.name}
              control={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!onOpen}
                  onClick={() => onOpen?.(bot.id)}
                >{t`Manage`}</Button>
              }
            >
              <p className="text-xs text-muted-foreground">{t`Open the chat to edit this Mico's instructions, tools and routine settings.`}</p>
            </SettingsRow>
          ))
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">{t`No Micos in this space.`}</p>
        )}
      </SettingsGroup>
      <SkillLibrarySettings />
    </div>
  );
}
export function MobileSettingsPanel() {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState("");
  const url = mobileInstallUrl(window.location.origin);
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopy(t`Link copied`);
    } catch {
      setCopy(t`Could not copy. Open the link above or type it on your phone.`);
    }
  }
  return (
    <div className="space-y-6">
      <SettingsGroup title={t`Mycellios on your phone`}>
        <SettingsRow
          label={t`Use your existing account`}
          control={
            <Button variant="outline" onClick={() => setOpen(true)}>{t`How to install`}</Button>
          }
        >
          <p className="text-sm text-muted-foreground">{t`Your chats and Micos follow your account. Open this link on iPhone or Android and add Mycellios to your Home Screen.`}</p>
        </SettingsRow>
        <SettingsRow
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
        />
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
    <div className="mb-6">
      <SettingsGroup title={t`Voice conversation`}>
        <SettingsRow
          label={t`Talk with your Mico`}
          control={
            <Button variant="outline" disabled={!onOpen} onClick={onOpen}>{t`Open voice`}</Button>
          }
        >
          <p className="text-xs text-muted-foreground">
            {onOpen
              ? t`Desktop can prepare local speech models in the voice panel. Browser speech depends on your device. The services below are optional alternatives.`
              : t`Select a Mico chat to start a voice conversation. You can manage voice services below.`}
          </p>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

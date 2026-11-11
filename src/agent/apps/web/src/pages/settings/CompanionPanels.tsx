import { DeviceVoiceSettings } from "./DeviceVoiceSettings";
import { MobileSessions } from "./MobileSessions";
import { useLingui } from "@lingui/react/macro";
import type { Bot, BusyMessageMode } from "@rakazo/contracts";
import { BotAvatar, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, OptionSelect } from "@rakazo/ui-web";
import { Disclosure } from "@rakazo/ui-web/components/ui/disclosure";
import { ServerLinkCode } from "../../components/ServerLinkCode";
import { useEffect, useRef, useState } from "react";
import { settingsMatch } from "./navigation";
import { MobileInstallOffer, mobileInstallUrl } from "../../components/MobileInstallOffer";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { SkillLibrarySettings } from "../SkillLibrarySettings";
import { setGeneralPreferences, useGeneralPreferences } from "../../lib/general-preferences";

export function MicosSettingsPanel({
  bots = [],
  onOpen,
  onModels,
  onBusyMessageModeChange,
  onBusyChange,
}: {
  bots?: Bot[];
  onOpen?: (id: string) => void;
  onSkills?: () => void;
  onModels?: () => void;
  onBusyMessageModeChange?: (id: string, value: BusyMessageMode | null) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useLingui();
  const value = useGeneralPreferences();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [search, setSearch] = useState("");
  useEffect(() => { onBusyChange?.(saving); }, [saving, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  const matchingBots = bots.filter(bot => settingsMatch({ label: bot.name }, search));
  const messageModes = [
    { value: "queue", label: t`Next turn` },
    { value: "steer", label: t`Current task` },
  ];
  async function saveMicoMessageMode(id: string, mode: string) {
    if (!onBusyMessageModeChange || savingRef.current) return;
    savingRef.current = true;
    setError("");
    setSaving(true);
    try {
      await onBusyMessageModeChange(id, mode === "inherit" ? null : mode as BusyMessageMode);
    } catch {
      setError(t`Could not save this preference.`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  return (
    <div className="rk-settings-panel space-y-6">
      <SettingsGroup title={t`Preferences`}>
        <SettingsRow label={t`Models and connections`} description={t`Choose a provider once. Your Micos use it automatically.`}
          control={<Button variant="outline" size="sm" disabled={!onModels || saving} onClick={onModels}>{t`Manage`}</Button>} />
        <SettingsRow label={t`Messages while a Mico works`} description={t`Default on this device. Each Mico can follow it or use its own preference.`}
          control={<OptionSelect aria-label={t`Messages while a Mico works`} value={value.busyMessageMode}
            className="w-48 max-w-full" options={messageModes} disabled={saving}
            onValueChange={busyMessageMode => { try { setGeneralPreferences({ busyMessageMode: busyMessageMode as "queue" | "steer" }); setError(""); } catch { setError(t`Could not save this preference.`); } }} />} />
      </SettingsGroup>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Disclosure summary={t`Customize by Mico`} className="rk-settings-details" summaryClassName="w-full py-2 text-sm font-medium">
      <p className="pb-3 text-sm text-muted-foreground">{t`Micos follow the default unless you choose otherwise.`}</p>
      {bots.length > 5 && <Input className="mb-3" aria-label={t`Search Micos`} placeholder={t`Search Micos…`} value={search} onChange={event => setSearch(event.target.value)} disabled={saving} />}
      <SettingsGroup>
        {bots.length ? (
          matchingBots.map((bot) => (
            <SettingsRow
              key={bot.id}
              label={<span className="flex min-w-0 items-center gap-3"><span className="shrink-0"><BotAvatar color={bot.color} size={28} /></span><span className="min-w-0 break-words">{bot.name}</span></span>}
              control={<div className="flex flex-wrap items-center gap-2">
                {onBusyMessageModeChange && <OptionSelect
                  aria-label={t`Messages while ${bot.name} works`}
                  value={bot.busyMessageMode ?? "inherit"}
                  options={[{ value: "inherit", label: t`Use default` }, ...messageModes]}
                  disabled={saving}
                  onValueChange={mode => void saveMicoMessageMode(bot.id, mode)}
                />}
                <Button variant="outline" size="sm" disabled={!onOpen || saving} onClick={() => onOpen?.(bot.id)}>
                  {t`Manage`}
                </Button>
              </div>}
            />
          ))
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">{t`No Micos in this space.`}</p>
        )}
      </SettingsGroup>
      {bots.length > 0 && matchingBots.length === 0 && <p role="status" className="py-3 text-sm text-muted-foreground">{t`No Micos match your search.`}</p>}
      </Disclosure>
      <SkillLibrarySettings />
    </div>
  );
}
export function MobileSettingsPanel({ accountId }: { accountId?: string }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [copy, setCopy] = useState("");
  const url = mobileInstallUrl(window.location.origin);
  const localOnly = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) || window.location.hostname.endsWith(".localhost");
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
            <Button variant="outline" onClick={() => localOnly ? setOpen(true) : setCodeOpen(true)}>
              {localOnly ? t`How to install` : t`Add phone`}
            </Button>
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
      <MobileSessions key={accountId ?? "signed-out"} accountId={accountId} />
      <Dialog open={codeOpen} onOpenChange={setCodeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t`Open Mycellios on your phone`}</DialogTitle>
            <DialogDescription>{t`Scan this code with your camera and sign in with the same account.`}</DialogDescription>
          </DialogHeader>
          {codeOpen && <ServerLinkCode url={url} />}
          <Button variant="outline" onClick={() => void copyLink()}>{t`Copy link`}</Button>
          <Button variant="ghost" onClick={() => { setCodeOpen(false); setOpen(true); }}>{t`How to install`}</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function VoiceEntryPanel({ onOpen, accountId, previewBotId, spaceId, onModels }: {
  onOpen?: () => void; accountId?: string; previewBotId?: string; spaceId?: string | null; onModels?: () => void;
}) {
  const { t } = useLingui();
  return (
    <div className="rk-general-settings mb-6">
      <DeviceVoiceSettings accountId={accountId} previewBotId={previewBotId} spaceId={spaceId} onModels={onModels} />
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

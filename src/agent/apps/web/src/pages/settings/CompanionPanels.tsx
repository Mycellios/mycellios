import { DeviceVoiceSettings } from "./DeviceVoiceSettings";
import { useLingui } from "@lingui/react/macro";
import type { Bot, BusyMessageMode } from "@rakazo/contracts";
import { BotAvatar, Button, Input, OptionSelect } from "@rakazo/ui-web";
import { Disclosure } from "@rakazo/ui-web/components/ui/disclosure";
import { useEffect, useRef, useState } from "react";
import { settingsMatch } from "./navigation";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { SkillLibrarySettings } from "../SkillLibrarySettings";
import { setGeneralPreferences, useGeneralPreferences } from "../../lib/general-preferences";
import { MicoBehaviorSettings } from "./MicoBehaviorSettings";
import { useSpaceRpc } from "../../lib/space-rpc";

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
  const client = useSpaceRpc();
  const value = useGeneralPreferences();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const savingRef = useRef(false);
  const [search, setSearch] = useState("");
  useEffect(() => { onBusyChange?.(saving || policySaving); }, [saving, policySaving, onBusyChange]);
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
  async function applyAllMessageModes(mode: string) {
    if (!mode || savingRef.current) return;
    savingRef.current = true; setError(""); setSaving(true);
    try { await client.preferences.applyBusyMode({ mode: mode === "inherit" ? null : mode as BusyMessageMode }); }
    catch { setError(t`Could not save this preference.`); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return (
    <div className="rk-settings-panel space-y-6">
      <MicoBehaviorSettings bots={bots} onBusyChange={setPolicySaving} />
      <SettingsGroup title={t`Preferences`}>
        <SettingsRow label={t`Models and connections`} description={t`Choose a provider once. Your Micos use it automatically.`}
          control={<Button variant="outline" size="sm" disabled={!onModels || saving} onClick={onModels}>{t`Manage`}</Button>} />
        <SettingsRow label={t`Messages while a Mico works`} description={t`Default on this device. Each Mico can follow it or use its own preference.`}
          control={<OptionSelect aria-label={t`Messages while a Mico works`} value={value.busyMessageMode}
            className="w-48 max-w-full" options={messageModes} disabled={saving}
            onValueChange={busyMessageMode => { try { setGeneralPreferences({ busyMessageMode: busyMessageMode as "queue" | "steer" }); setError(""); } catch { setError(t`Could not save this preference.`); } }} />} />
      </SettingsGroup>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Disclosure alwaysVisible summary={t`Customize by Mico`} className="rk-settings-details" summaryClassName="w-full py-2 text-sm font-medium">
      <p className="pb-3 text-sm text-muted-foreground">{t`Micos follow the default unless you choose otherwise.`}</p>
      <div className="mb-3 flex justify-end"><OptionSelect aria-label={t`Apply message mode to all Micos`} value="" disabled={saving || policySaving || !bots.length}
        options={[{ value: "", label: t`Apply to all` }, { value: "inherit", label: t`Use default` }, ...messageModes]} onValueChange={mode => void applyAllMessageModes(mode)} /></div>
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
export { MobileSettingsPanel } from "./MobileConnectionSettings";

export function VoiceEntryPanel({ onOpen, accountId, previewBotId, spaceId, onModels, onBusyChange }: {
  onOpen?: () => void; accountId?: string; previewBotId?: string; spaceId?: string | null; onModels?: () => void; onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useLingui();
  return (
    <div className="rk-general-settings mb-6">
      <DeviceVoiceSettings onBusyChange={onBusyChange} accountId={accountId} previewBotId={previewBotId} spaceId={spaceId} onModels={onModels} />
      {<SettingsGroup title={t`Live voice`}>
        <SettingsRow
          label={t`Talk with your Mico`} description={onOpen ? t`Uses the dictation and spoken-reply models selected above. Start speaking to interrupt a reply.` : t`Open a Mico and configure dictation and spoken replies to start a voice conversation.`}
          control={
            <Button variant="outline" disabled={!onOpen} onClick={onOpen}>{t`Open voice`}</Button>
          }
        />
      </SettingsGroup>}
    </div>
  );
}

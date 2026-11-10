import { useLingui } from "@lingui/react/macro";
import { Button, Label, OptionSelect, Switch } from "@rakazo/ui-web";
import { useEffect, useId, useState } from "react";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { desktopBridge } from "../../lib/desktop";
import { setGeneralPreferences, useGeneralPreferences, type GeneralPreferences } from "../../lib/general-preferences";
import { UI_LOCALES, UI_LOCALE_LABELS } from "../../lib/ui-locale";

export function DeviceVoiceSettings() {
  const { t } = useLingui(); const id = useId(); const value = useGeneralPreferences();
  const native = desktopBridge()?.localVoice;
  const [status, setStatus] = useState<Awaited<ReturnType<NonNullable<typeof native>["status"]>>>();
  const [preparing, setPreparing] = useState(false); const [error, setError] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const speech = window.speechSynthesis;
    if (!speech) return;
    const refresh = () => setVoices(speech.getVoices().filter(voice => voice.localService));
    refresh(); speech.addEventListener("voiceschanged", refresh);
    return () => speech.removeEventListener("voiceschanged", refresh);
  }, []);
  useEffect(() => {
    let live = true;
    const refresh = () => void native?.status().then(next => { if (live) setStatus(next); }).catch(() => { if (live) setError(t`Could not check local voice. Try again.`); });
    refresh(); const timer = preparing || status?.preparing ? window.setInterval(refresh, 1000) : undefined;
    return () => { live = false; window.clearInterval(timer); };
  }, [native, preparing, status?.preparing]);
  function save(patch: Partial<GeneralPreferences>) {
    try { setGeneralPreferences(patch); setError(""); } catch { setError(t`Could not save this preference.`); }
  }
  async function prepare() {
    if (!native || preparing) return; setPreparing(true); setError("");
    try { await native.prepare(); setStatus(await native.status()); }
    catch { setError(t`Could not prepare local voice. Try again.`); } finally { setPreparing(false); }
  }
  return <div className="mb-6 space-y-6">
    {native && <SettingsGroup title={t`Voice processing`}>
      <SettingsRow label={t`Spoken replies`} description={t`Local voice stays on this computer and uses no credits. Connected providers use their own account.`}
        control={<OptionSelect aria-label={t`Spoken replies`} value={value.speechEngine} options={[{value:"local",label:t`Local · Supertonic 3`},{value:"provider",label:t`Connected provider`}]} onValueChange={speechEngine => save({speechEngine:speechEngine as "local" | "provider"})} />} />
    </SettingsGroup>}
    <SettingsGroup title={t`Dictation`}>
      {native && <SettingsRow label="Parakeet TDT 0.6B v3 + Supertonic 3" description={t`Transcribe and speak on this PC. Download once when you choose.`}
        control={<Button variant="outline" size="sm" disabled={preparing || status?.preparing || status?.ready} onClick={() => void prepare()}>
          {status?.ready ? t`Ready` : preparing || status?.preparing ? t`Preparing…` : t`Download models`}
        </Button>}>
        {(preparing || status?.preparing) && status?.total ? <p role="status" className="mt-2 text-xs text-muted-foreground">{Math.round(status.downloaded / 1024 / 1024)} / {Math.round(status.total / 1024 / 1024)} MB</p> : null}
      </SettingsRow>}
      <SettingsRow label={t`Dictation language`} description={t`Language hint for the browser and connected transcription services.`}
        control={<OptionSelect aria-label={t`Dictation language`} value={value.dictationLanguage} className="w-48 max-w-full"
          options={[{ value: "auto", label: t`Automatic` }, ...UI_LOCALES.map(locale => ({ value: locale, label: UI_LOCALE_LABELS[locale] }))]}
          onValueChange={dictationLanguage => save({ dictationLanguage })} />} />
    </SettingsGroup>
    <SettingsGroup title={t`Read aloud`}>
      <SettingsRow label={<Label htmlFor={id}>{t`Read new replies aloud`}</Label>} description={t`Read new replies in the open chat on this device. Existing Mico voice preferences still apply.`}
        control={<Switch id={id} checked={value.readReplies} onCheckedChange={readReplies => save({ readReplies })} />} />
      {voices.length > 0 && (!native || value.speechEngine === "provider") && <SettingsRow label={t`Device voice`} description={t`Used when reading with your device instead of a connected provider.`}
        control={<OptionSelect aria-label={t`Device voice`} value={value.deviceVoice} className="w-48 max-w-full"
          options={[{ value: "default", label: t`Automatic` }, ...voices.map(voice => ({ value: voice.voiceURI, label: `${voice.name} · ${voice.lang}` }))]}
          onValueChange={deviceVoice => save({ deviceVoice })} />} />}
      <SettingsRow label={t`Playback speed`} control={<OptionSelect aria-label={t`Playback speed`} value={String(value.speechSpeed)} className="w-48 max-w-full"
        options={[0.75, 1, 1.25, 1.5, 2].map(speed => ({ value: String(speed), label: `${speed}×` }))}
        onValueChange={speed => save({ speechSpeed: Number(speed) })} />} />
    </SettingsGroup>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}

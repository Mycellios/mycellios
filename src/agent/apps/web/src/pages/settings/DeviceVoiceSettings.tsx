import { useLingui } from "@lingui/react/macro";
import type { LocalVoiceModelKind } from "@rakazo/contracts";
import { Button, Label, OptionSelect, Switch } from "@rakazo/ui-web";
import { useEffect, useId, useState } from "react";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { desktopBridge } from "../../lib/desktop";
import { setGeneralPreferences, useGeneralPreferences, type GeneralPreferences } from "../../lib/general-preferences";
import { UI_LOCALES, UI_LOCALE_LABELS } from "../../lib/ui-locale";

export function DeviceVoiceSettings({ accountId }: { accountId?: string }) {
  const { t } = useLingui(); const id = useId(); const value = useGeneralPreferences();
  const native = desktopBridge()?.localVoice;
  const [status, setStatus] = useState<Awaited<ReturnType<NonNullable<typeof native>["status"]>>>();
  const [operation, setOperation] = useState<LocalVoiceModelKind | "both">();
  const [error, setError] = useState("");
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
    refresh();
    const timer = operation || status?.preparing ? window.setInterval(refresh, 1000) : undefined;
    return () => { live = false; window.clearInterval(timer); };
  }, [native, operation, status?.preparing]);
  function save(patch: Partial<GeneralPreferences>) {
    try { setGeneralPreferences(patch); setError(""); } catch { setError(t`Could not save this preference.`); }
  }
  async function changeModel(kind: LocalVoiceModelKind | "both", remove = false) {
    if (!native || operation) return;
    setOperation(kind);
    setError("");
    try {
      if (remove && kind !== "both" && native.removeModel) await native.removeModel(kind);
      else if (kind !== "both" && native.prepareModel) await native.prepareModel(kind);
      else await native.prepare();
    } catch {
      setError(remove ? t`Could not remove the model. Stop local voice and try again.` : t`Could not prepare local voice. Try again.`);
    } finally {
      await native.status().then(setStatus).catch(() => {});
      setOperation(undefined);
    }
  }
  function modelRow(kind: LocalVoiceModelKind | "both", name: string, description: string) {
    const model = kind === "both" ? status : status?.models?.[kind];
    const canRemove = kind !== "both" && Boolean(native?.removeModel);
    const preparing = Boolean(model?.preparing || (operation === kind && !model?.ready));
    return <SettingsRow label={name} description={description}
      control={<Button variant="outline" size="sm"
        aria-label={model?.ready && canRemove ? t`Remove ${name}` : !model?.ready && !preparing ? t`Download ${name}` : undefined}
        disabled={!model || Boolean(operation) || status?.preparing || (model.ready && !canRemove)}
        onClick={() => void changeModel(kind, model?.ready)}>
        {model?.ready ? canRemove ? t`Remove` : t`Ready` : preparing ? t`Preparing…` : t`Download`}
      </Button>}>
      {preparing && model?.total ? <p role="status" className="mt-2 text-xs tabular-nums text-muted-foreground">{Math.round(model.downloaded / 1024 / 1024)} / {Math.round(model.total / 1024 / 1024)} MB</p> : null}
    </SettingsRow>;
  }
  const separateModels = Boolean(native?.prepareModel && status?.models);
  const networkSelected = Boolean(accountId && value.networkSpeechAccount === accountId);
  const conversationOutput = networkSelected ? "network" : native ? value.speechEngine : "provider";
  return <div className="mb-6 space-y-6">
    {(native || accountId) && <SettingsGroup title={t`Voice processing`}>
      <SettingsRow label={t`Voice conversation output`}
        description={networkSelected
          ? t`Mycellios reads replies in Spanish and English using your connected account and credits. Dictation uses your existing settings.`
          : t`Local voice stays on this computer and uses no credits. Connected providers use their own account.`}
        control={<OptionSelect
          aria-label={t`Voice conversation output`}
          value={conversationOutput}
          options={[
            ...(native ? [{ value: "local", label: t`Local · Supertonic 3` }] : []),
            { value: "provider", label: t`Connected provider` },
            ...(accountId ? [{ value: "network", label: t`Mycellios network · uses credits` }] : []),
          ]}
          onValueChange={choice => {
            if (choice === "network" && accountId) save({ networkSpeechAccount: accountId });
            if (choice === "local" || choice === "provider") {
              save({ speechEngine: choice, ...(networkSelected ? { networkSpeechAccount: "" } : {}) });
            }
          }}
        />} />
    </SettingsGroup>}
    <SettingsGroup title={t`Dictation`}>
      {native && (separateModels
        ? modelRow("asr", "Parakeet TDT 0.6B v3", t`Transcribes on this computer and detects the language automatically.`)
        : modelRow("both", "Parakeet TDT 0.6B v3 + Supertonic 3", t`Transcribe and speak on this computer.`))}
      <SettingsRow label={t`Dictation language`} description={t`Language hint for the browser and connected transcription services.`}
        control={<OptionSelect aria-label={t`Dictation language`} value={value.dictationLanguage} className="w-48 max-w-full"
          options={[{ value: "auto", label: t`Automatic` }, ...UI_LOCALES.map(locale => ({ value: locale, label: UI_LOCALE_LABELS[locale] }))]}
          onValueChange={dictationLanguage => save({ dictationLanguage })} />} />
    </SettingsGroup>
    <SettingsGroup title={t`Read aloud`}>
      {separateModels && modelRow("tts", "Supertonic 3", t`Reads replies aloud on this computer.`)}
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

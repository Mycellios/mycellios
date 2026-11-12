import { useLingui } from "@lingui/react/macro";
import { Button, OptionSelect } from "@rakazo/ui-web";
import { Volume2 } from "lucide-react";
import { useState } from "react";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { setGeneralPreferences, useGeneralPreferences } from "../../lib/general-preferences";
import { previewReplySound } from "../../lib/reply-sound";
export function SoundSettings({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLingui(); const value = useGeneralPreferences(); const [error, setError] = useState("");
  const choices = [{ value: "off", label: t`None` }, { value: "default", label: t`Warm` },
    { value: "mech", label: t`Mechanical` }, { value: "bubble", label: t`Bubble` }, { value: "press", label: t`Press` }];
  const rows = <>
    {(["taskSound", "actionSound"] as const).map(key => <SettingsRow key={key}
      label={key === "taskSound" ? t`Task completion sound` : t`Action sounds`}
      description={key === "taskSound" ? t`A short sound when a Mico finishes a reply.` : t`Short sounds for your own actions, such as a click.`}
      control={<div className="flex min-w-0 items-center gap-2" data-sound-preview>
        <Button variant="ghost" size="icon" aria-label={t`Preview sound`} disabled={value[key] === "off"}
          onClick={() => { void previewReplySound(value[key]).then(played => setError(played ? "" : t`Could not play the sound. Check your audio output.`)); }}><Volume2 className="size-4" /></Button>
        <OptionSelect aria-label={key === "taskSound" ? t`Task completion sound` : t`Action sounds`} value={value[key]}
          className="w-40 max-w-full" options={key === "taskSound" ? [choices[0]!, { value: "classic", label: t`Classic` }, ...choices.slice(1)] : choices}
          onValueChange={choice => { try { setGeneralPreferences({ [key]: choice }); setError(""); } catch { setError(t`Could not save this preference.`); } }} />
      </div>} />)}
    {error && <p role="alert" className="px-4 py-2 text-sm text-destructive">{error}</p>}
  </>;
  return embedded ? rows : <SettingsGroup title={t`Sounds`}>{rows}</SettingsGroup>;
}

import { useLingui } from "@lingui/react/macro";
import { Button } from "@mycellios/ui-web";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { formatModelSize, useLocalModels } from "../../lib/local-models";
import { errorText } from "../../lib/user-error";

/**
 * Settings → Models → On your PC (specs/local-models/spec.md): the models installed on
 * this PC, their measured speed, and freeing memory or disk. Installing starts from the
 * chat model picker, where the person chooses the model for a Mico.
 */
export function LocalModelsSettings() {
  const { t } = useLingui();
  const { available, status, error, busy, act } = useLocalModels();
  if (!available || !status?.supported) return null;
  const installed = status.models.filter((model) => model.installed);
  const used = installed.reduce((sum, model) => sum + model.bytes, 0);
  return <SettingsGroup title={t`On your PC`}>
    <SettingsRow label={t`Models on this PC`}
      description={installed.length
        ? t`${installed.length} installed, ${formatModelSize(used)} on disk. They run here, free and private.`
        : t`None yet. Choose "On your PC" in a Mico's model menu to install one with a single click.`} />
    {installed.map((model) => <SettingsRow key={model.id} label={model.name}
      description={model.speed.measured
        ? t`${formatModelSize(model.bytes)} · about ${Math.max(1, Math.round(model.speed.generation * 0.75))} words per second, measured on this PC`
        : formatModelSize(model.bytes)}
      control={<div className="flex gap-2">
        {status.loaded === model.id ? <Button variant="outline" size="sm" disabled={busy} onClick={() => void act((bridge) => bridge.unload()).catch(() => undefined)}>{t`Free memory`}</Button> : null}
        <Button variant="outline" size="sm" disabled={busy || Boolean(status.job)} aria-label={t`Delete ${model.name}`}
          onClick={() => void act((bridge) => bridge.remove(model.id)).catch(() => undefined)}>{t`Delete`}</Button>
      </div>} />)}
    {error ? <p role="alert" className="px-4 py-3 text-xs text-destructive">{errorText(error)}</p> : null}
  </SettingsGroup>;
}

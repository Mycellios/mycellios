import { useLingui } from "@lingui/react/macro";
import type { DesktopUpdatePreferences } from "@rakazo/contracts";
import { isBuildId } from "@rakazo/contracts/client-build";
import { Button, Label, Switch } from "@rakazo/ui-web";
import { Disclosure } from "@rakazo/ui-web/components/ui/disclosure";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { DesktopUpdateSection, useDesktopUpdateSettings } from "../../components/DesktopUpdates";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { CLIENT_BUILD } from "../../lib/client-build";
import { clientUpdates } from "../../lib/client-update";
import { desktopBridge } from "../../lib/desktop";

export function UpdatesPanel({ onWhatsNew, onClose, onBusyChange }: {
  onWhatsNew?: () => void; onClose: () => void; onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useLingui(); const id = useId();
  const bridge = desktopBridge()?.update;
  const native = useDesktopUpdateSettings();
  const updates = clientUpdates();
  const available = useSyncExternalStore(updates.subscribe, updates.getSnapshot, () => null);
  const [preferences, setPreferences] = useState<DesktopUpdatePreferences>();
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  useEffect(() => { let active = true;
    if (bridge?.preferences) void bridge.preferences().then(value => { if (active) setPreferences(value); })
      .catch(() => { if (active) setError(t`Could not load update settings. Try again.`); });
    return () => { active = false; };
  }, [bridge]);
  const pending = busy || Boolean(native?.busy);
  // Downloads belong to the native provider and continue if this panel closes.
  // Only a settings write needs to hold navigation in this panel.
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  async function save(patch: { autoDownload?: boolean; autoInstall?: boolean }) {
    if (!bridge?.savePreferences || busy) return; setBusy(true); setError("");
    try { setPreferences(await bridge.savePreferences(patch)); }
    catch { setError(t`Could not save this preference.`); } finally { setBusy(false); }
  }
  async function checkWeb() {
    if (busy) return; setBusy(true); setError(""); setMessage("");
    try { const result = await updates.checkForUpdates();
      if (!result || !isBuildId(result)) setError(t`Could not check for updates. Try again.`);
      else setMessage(t`Up to date`);
    } catch { setError(t`Could not check for updates. Try again.`); } finally { setBusy(false); }
  }
  const state = native?.state;
  const supported = state?.phase !== "unsupported";
  const restarting = state?.relaunchPending || state?.installPending;
  const phase = state?.phase;
  const systemInstaller = state?.installAction === "system-installer";
  const nativeMessage = restarting ? (state?.relaunchWaitingFor === "update_download" ? t`Waiting for the update download to finish.` : state?.relaunchWaitingFor === "unsaved_work" || state?.waitingFor === "unsaved_work"
      ? t`Save changes or finish the call to restart.` : t`Waiting for Micos to finish. You can keep working.`)
    : state?.relaunchError ? t`Could not restart. Try again.`
    : state?.handoffComplete ? t`Opened the system installer. Restart Mycellios when it finishes.`
    : phase === "unsupported" ? t`This development build updates from the project. Installed apps use published releases.`
    : phase === "downloading" ? t`Downloading…`
    : phase === "ready" ? t`The update is ready to install.`
    : phase === "available" ? t`A new version is available.`
    : native?.message ? native.message
    : native?.confirmedCheck ? t`Up to date` : t`You receive tested releases from the stable channel.`;
  const action = phase === "available" ? "download" : phase === "ready" ? "install" : "check";
  return <div className="rk-settings-panel space-y-6" data-testid={bridge ? "desktop-update-settings" : "web-update-settings"}>
    <section>
      <h3 className="mb-2 text-sm font-medium">{t`Mycellios updates`}</h3>
      <Button variant="outline" className="mb-2 w-full" disabled={!onWhatsNew || pending} onClick={onWhatsNew}>{t`What's new in Mycellios`}</Button>
      <SettingsGroup>
        <SettingsRow label={t`Update channel`} description={preferences?.channel === "development" ? t`You are using the local development version.` : t`Tested versions of Mycellios.`}
          control={<span className="rk-settings-value">{preferences?.channel === "development" ? t`Development` : t`Stable`}</span>} />
        {bridge && state ? <>
          <SettingsRow label={`${t`Version`} ${state.currentVersion}`} description={<span role="status">{nativeMessage}</span>}
            control={<Button variant="outline" size="sm" disabled={pending || restarting || !supported || phase === "checking" || phase === "downloading"}
              onClick={() => void native?.act(action)}>{phase === "downloading" ? `${Math.round(state.percent ?? 0)} %` : phase === "checking" ? t`Checking…` : phase === "ready" ? (systemInstaller ? t`Open installer` : t`Restart to update`) : phase === "available" ? t`Download update` : t`Check for updates`}</Button>} />
          {bridge.restartWhenIdle && <SettingsRow label={t`Restart Mycellios`} description={t`Restart when Micos are idle, after saving drafts and finishing calls.`}
            control={<Button variant="outline" size="sm" disabled={pending} onClick={() => void native?.act(restarting ? "cancelRestart" : "restartWhenIdle")}>
              {restarting ? t`Cancel restart` : t`Restart when idle`}</Button>} />}
          {preferences && <>
            <SettingsRow label={<Label htmlFor={`${id}-download`}>{t`Download updates automatically`}</Label>} description={t`Download new versions in the background.`}
              control={<Switch id={`${id}-download`} checked={preferences.autoDownload} disabled={pending || !preferences.supported}
                onCheckedChange={autoDownload => void save({ autoDownload })} />} />
            <SettingsRow label={<Label htmlFor={`${id}-install`}>{t`Install updates automatically`}</Label>} description={t`Restart with the downloaded version when your Micos and this app are idle.`}
              control={<Switch id={`${id}-install`} checked={preferences.autoInstall} disabled={pending || !preferences.supported || preferences.installSupported === false}
                onCheckedChange={autoInstall => void save({ autoInstall })} />} />
          </>}
        </> : !bridge ? <>
          <SettingsRow label={t`Web app`} description={t`The server keeps Mycellios up to date. Drafts and calls are protected.`}
            control={<Button variant="outline" size="sm" disabled={pending || !isBuildId(CLIENT_BUILD)} onClick={() => void checkWeb()}>{pending ? t`Checking…` : t`Check for updates`}</Button>} />
          {available && <SettingsRow label={t`Update available`} control={<Button onClick={onClose}>{t`Return to app`}</Button>} />}
          {message && <p role="status" className="p-4 text-sm text-muted-foreground">{message}</p>}
        </> : <div className="px-4 py-3"><DesktopUpdateSection /></div>}
      </SettingsGroup>
    </section>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Disclosure summary={t`Version details`} className="rk-settings-details" summaryClassName="w-full py-2 text-sm text-muted-foreground">
      <div className="space-y-3 pt-2 text-sm text-muted-foreground">
        <p>{t`Web version`}: {isBuildId(CLIENT_BUILD) ? CLIENT_BUILD : t`Development preview`}</p>
        <a href="https://github.com/Mycellios/mycellios/releases" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{t`Version history`}</a>
        <p><a href="https://www.mycellios.com/downloads/desktop" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{t`Download Mycellios Desktop`}</a></p>
      </div>
    </Disclosure>
  </div>;
}

import { useLingui } from "@lingui/react/macro";
import type { DesktopUpdatePreferences } from "@rakazo/contracts";
import { compareBuilds, isBuildId } from "@rakazo/contracts/client-build";
import { Button, Label, Switch } from "@rakazo/ui-web";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
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
  const lock = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [preferences, setPreferences] = useState<DesktopUpdatePreferences>();
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  useEffect(() => { let active = true;
    setError("");
    if (bridge?.preferences) void bridge.preferences().then(value => { if (active) setPreferences(value); })
      .catch(() => { if (active) setError(t`Could not load update settings. Try again.`); });
    return () => { active = false; };
  }, [bridge, attempt]);
  const pending = busy || Boolean(native?.busy);
  // Downloads belong to the native provider and continue if this panel closes.
  // Only a settings write needs to hold navigation in this panel.
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  async function save(patch: { autoDownload?: boolean; autoInstall?: boolean }) {
    if (!bridge?.savePreferences || !preferences?.supported || lock.current) return; lock.current = true; setBusy(true); setError("");
    try { setPreferences(await bridge.savePreferences(patch)); }
    catch { setError(t`Could not save this preference.`); } finally { lock.current = false; setBusy(false); }
  }
  async function checkWeb() {
    if (lock.current || !isBuildId(CLIENT_BUILD)) return; lock.current = true; setBusy(true); setError(""); setMessage("");
    try { const result = await updates.checkForUpdates();
      if (!result || !isBuildId(result)) setError(t`Could not check for updates. Try again.`);
      else {
        const compared = compareBuilds(CLIENT_BUILD, result);
        if (compared === 0) setMessage(t`Up to date`);
        else if (compared !== null && compared < 0) setMessage(t`A new version is available.`);
        else setError(t`The server is serving an older version. Try again later.`);
      }
    } catch { setError(t`Could not check for updates. Try again.`); } finally { lock.current = false; setBusy(false); }
  }
  const state = native?.state;
  const supported = preferences ? preferences.supported : state?.phase !== "unsupported";
  const restarting = state?.relaunchPending || state?.installPending;
  const phase = state?.phase;
  const systemInstaller = state?.installAction === "system-installer";
  const nativeMessage = restarting ? (state?.relaunchWaitingFor === "update_download" ? t`Waiting for the update download to finish.` : state?.relaunchWaitingFor === "unsaved_work" || state?.waitingFor === "unsaved_work"
      ? t`Save changes or finish the call to restart.` : t`Waiting for Micos to finish. You can keep working.`)
    : state?.relaunchError ? t`Could not restart. Try again.`
    : state?.handoffComplete ? t`Opened the system installer. Restart Mycellios when it finishes.`
    : phase === "unsupported" ? preferences?.channel === "development" ? t`This development build updates from the project. Installed apps use published releases.` : t`No published update is available for this installation. You can check again later.`
    : phase === "error" ? native?.message || t`Could not complete the update. Try again.`
    : phase === "checking" ? t`Checking…`
    : phase === "downloading" ? t`Downloading…`
    : phase === "ready" ? t`The update is ready to install.`
    : phase === "available" ? t`A new version is available.`
    : native?.message ? native.message
    : native?.confirmedCheck ? t`Up to date` : t`You receive tested releases from the stable channel.`;
  const action = phase === "available" ? "download" : phase === "ready" ? "install" : "check";
  const webDevelopment = !isBuildId(CLIENT_BUILD);
  const channel = bridge ? preferences?.channel === "development" ? t`Development` : preferences ? t`Stable` : t`Loading…` : webDevelopment ? t`Development` : t`Managed by the server`;
  const webMessage = webDevelopment ? t`Local development updates automatically as the project changes.` : available ? t`A new version is available. Return to the app to finish updating when your work is saved.` : message || t`The web app receives updates from this server. Your drafts and calls are protected.`;
  return <div className="rk-general-settings space-y-4" data-testid={bridge ? "desktop-update-settings" : "web-update-settings"}>
    <section data-slot="settings-section" className="space-y-3">
      <h3 className="px-1 text-sm font-medium">{t`Mycellios updates`}</h3>
      {onWhatsNew ? <Button variant="outline" className="w-full" disabled={pending} onClick={onWhatsNew}>{t`What's new in Mycellios`}</Button>
        : <a href="https://github.com/Mycellios/mycellios/releases" target="_blank" rel="noopener noreferrer" className="flex min-h-9 w-full items-center justify-center rounded-lg border border-border px-3 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">{t`What's new in Mycellios`}</a>}
      <SettingsGroup>
        <SettingsRow label={t`Update channel`} description={bridge ? preferences?.channel === "development" ? t`You are using the local development version.` : t`The stable channel receives tested releases of Mycellios.` : webDevelopment ? t`You are using the local development version.` : t`The server publishes updates for the web app.`}
          control={<span className="rk-settings-value">{channel}</span>} />
        {bridge && state ? <>
          <SettingsRow label={`${t`Version`} ${state.currentVersion}`} description={<span role="status">{nativeMessage}</span>}
            control={<Button variant="outline" size="sm" disabled={pending || restarting || !supported || phase === "checking" || phase === "downloading"}
              onClick={() => void native?.act(action)}>{phase === "downloading" ? `${Math.round(state.percent ?? 0)} %` : phase === "checking" ? t`Checking…` : phase === "ready" ? (systemInstaller ? t`Open installer` : t`Restart to update`) : phase === "available" ? t`Download update` : t`Check for updates`}</Button>} />
          {phase === "downloading" && <div className="px-4 pb-3"><progress aria-label={t`Download progress`} max={100} value={Math.max(0, Math.min(100, state.percent ?? 0))} className="h-1.5 w-full accent-primary" /></div>}
          {bridge.restartWhenIdle && <SettingsRow label={t`Restart Mycellios`} description={t`Restart when Micos are idle, after saving drafts and finishing calls.`}
            control={<Button variant="outline" size="sm" disabled={pending} onClick={() => void native?.act(restarting ? "cancelRestart" : "restartWhenIdle")}>
              {restarting ? t`Cancel restart` : t`Restart when idle`}</Button>} />}
          {preferences && <>
            <SettingsRow label={<Label htmlFor={`${id}-download`}>{t`Download updates automatically`}</Label>} description={preferences.supported ? t`Download new versions in the background.` : t`This installation is updated from the project or its system installer.`}
              control={<Switch id={`${id}-download`} checked={preferences.autoDownload} disabled={pending || !preferences.supported}
                onCheckedChange={autoDownload => void save({ autoDownload })} />} />
            <SettingsRow label={<Label htmlFor={`${id}-install`}>{t`Install updates automatically`}</Label>} description={preferences.installSupported === false ? t`Updates are installed with your system installer. Mycellios will not restart automatically.` : t`Restart with the downloaded version when your Micos and this app are idle.`}
              control={<Switch id={`${id}-install`} checked={preferences.autoInstall} disabled={pending || !preferences.supported || preferences.installSupported === false}
                onCheckedChange={autoInstall => void save({ autoInstall })} />} />
          </>}
        </> : !bridge ? <>
          <SettingsRow label={webDevelopment ? t`Local development` : t`Web app`} description={<span role="status">{webMessage}</span>}
            control={!webDevelopment ? <Button variant="outline" size="sm" disabled={pending} onClick={() => void checkWeb()}>{pending ? t`Checking…` : t`Check for updates`}</Button> : undefined} />
          {available && !webDevelopment && <SettingsRow label={t`Update available`} description={t`Your work is preserved before the web app reloads.`} control={<Button variant="outline" size="sm" onClick={onClose}>{t`Return to app`}</Button>} />}
        </> : <div className="px-4 py-3"><p role="status" className="text-sm text-muted-foreground">{t`Reading desktop update status…`}</p><DesktopUpdateSection /></div>}
      </SettingsGroup>
    </section>
    {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p>{bridge?.preferences && !preferences && <Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>{t`Retry`}</Button>}</div>}
    <div className="flex flex-wrap gap-x-5 gap-y-2 px-1 text-xs text-muted-foreground">
      <a href="https://github.com/Mycellios/mycellios/releases" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{t`Version history`}</a>
      {!bridge && <a href="https://www.mycellios.com/downloads/desktop" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{t`Download Mycellios Desktop`}</a>}
    </div>
  </div>;
}

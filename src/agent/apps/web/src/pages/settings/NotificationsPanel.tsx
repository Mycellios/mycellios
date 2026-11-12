import { SoundSettings } from "./SoundSettings";
import { useLingui } from "@lingui/react/macro";
import type { Bot, NotificationSettings } from "@rakazo/contracts";
import { BotAvatar, Button, Label, Switch, OptionSelect } from "@rakazo/ui-web";
import { Bell, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { rpc } from "../../lib/rpc";
import { enableWebPush, isInstalledWebApp, notificationClientId, pushSupported } from "../../lib/web-push";
import { desktopBridge } from "../../lib/desktop";
import { isAndroidHost } from "../../lib/android-host";
import { notificationEnvironment } from "../../lib/notification-environment";
import { requestBrowserNotificationPermission, showSystemNotification } from "../../lib/browser-notifications";
import { rememberNotificationSettings } from "../../lib/account-notifications";
import { notificationPreferences, notificationSnapshot, saveNotificationPreferences, subscribeNotifications } from "../../lib/notification-preferences";

type Status = Awaited<ReturnType<typeof rpc.notifications.webStatus>>;
function LevelPicker({ label, value, disabled, onChange }: { label: string; value: NotificationSettings["level"]; disabled: boolean; onChange: (value: NotificationSettings["level"]) => void }) {
  const { t } = useLingui();
  return <div role="group" aria-label={label} className="inline-flex max-w-full rounded-lg bg-background/60 p-1">
    {([{ value: "all", label: t`All` }, { value: "needs_me", label: t`If I’m needed` }, { value: "off", label: t`No alerts` }] as const).map(item =>
      <Button key={item.value} variant="ghost" size="sm" aria-pressed={value === item.value} disabled={disabled}
        className={value === item.value ? "bg-background text-foreground" : "text-muted-foreground"}
        onClick={() => { if (item.value !== value) onChange(item.value); }}>{item.label}</Button>)}
  </div>;
}
type NotificationPanelProps = { scope: string; bots?: Bot[]; onUpdate?: (id: string, enabled: boolean) => Promise<void>; onBusyChange?: (value: boolean) => void };
export function NotificationsPanel(props: NotificationPanelProps) { return <NotificationControls key={props.scope} {...props} />; }
function NotificationControls({ scope, bots = [], onUpdate, onBusyChange }: NotificationPanelProps) {
  const { t } = useLingui(), id = useId();
  useSyncExternalStore(useCallback(listener => subscribeNotifications(scope, listener), [scope]), useCallback(() => notificationSnapshot(scope), [scope]), () => "");
  const value = notificationPreferences(scope);
  const [loaded, setLoaded] = useState<{ scope: string; state: Status }>();
  const push = loaded?.scope === scope ? loaded.state : undefined;
  const [loadError, setLoadError] = useState(false), [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<string | null>(null), lock = useRef(false);
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const activeScope = useRef(scope); activeScope.current = scope;
  const generation = useRef(0);
  const [now, setNow] = useState(Date.now);
  const localPaused = value.mutedUntil > now;
  const accountPaused = Boolean(push?.settings.mutedUntil && Date.parse(push.settings.mutedUntil) > now);
  const native = desktopBridge()?.notifications;
  const [nativeStatus, setNativeStatus] = useState<{ supported: boolean; settingsAvailable: boolean }>();
  const [permission, setPermission] = useState(() => typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const environment = notificationEnvironment({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints,
    secure: window.isSecureContext, installed: isInstalledWebApp(), push: pushSupported(), androidHost: isAndroidHost(), nativeDesktop: Boolean(desktopBridge()) });
  useEffect(() => {
    let disposed = false;
    const sync = () => { setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission); void native?.status().then(state => { if (!disposed) setNativeStatus(state); }).catch(() => undefined); };
    sync(); window.addEventListener("focus", sync); return () => { disposed = true; window.removeEventListener("focus", sync); };
  }, [native]);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (!scope || lock.current) return;
      const request = ++generation.current;
      try {
        const state = await rpc.notifications.webStatus({ clientId: notificationClientId() });
        if (!cancelled && request === generation.current) { setLoaded({ scope, state }); rememberNotificationSettings(scope, state.settings); setLoadError(false); }
      } catch { if (!cancelled && request === generation.current) setLoadError(true); }
    };
    void refresh(); window.addEventListener("focus", refresh); window.addEventListener("mycellios:notifications-changed", refresh);
    return () => { cancelled = true; ++generation.current; window.removeEventListener("focus", refresh); window.removeEventListener("mycellios:notifications-changed", refresh); };
  }, [scope, retry]);
  useEffect(() => { onBusyChange?.(busy !== null); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  useEffect(() => {
    const expires = [value.mutedUntil, push?.settings.mutedUntil ? Date.parse(push.settings.mutedUntil) : 0].filter(at => at > Date.now());
    if (!expires.length) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(Math.min(...expires) - Date.now() + 1, 3_600_001));
    return () => window.clearTimeout(timer);
  }, [now, value.mutedUntil, push?.settings.mutedUntil]);
  async function action(key: string, work: () => Promise<void>) {
    if (lock.current) return;
    const owner = scope; lock.current = true; ++generation.current; setBusy(key); setError(""); setMessage("");
    try { await work(); } catch { if (activeScope.current === owner) setError(t`Could not save or complete this action. Try again.`); }
    finally { lock.current = false; if (activeScope.current === owner) setBusy(null); }
  }
  function save(patch: Partial<typeof value>) {
    try { saveNotificationPreferences(scope, { ...value, ...patch }); setError(""); } catch { setError(t`Could not save this preference.`); }
  }
  async function saveAccount(patch: Partial<NotificationSettings>) {
    if (!push) return;
    const owner = scope;
    await action("account", async () => {
      const settings = await rpc.notifications.saveSettings({ ...push.settings, ...patch });
      if (activeScope.current !== owner) return;
      rememberNotificationSettings(owner, settings); setLoaded({ scope: owner, state: { ...push, settings } });
      window.dispatchEvent(new Event("mycellios:notifications-changed"));
    });
  }
  const eligibleBots = push?.bots ?? bots;
  const overrides = Object.entries(push?.settings.bots ?? {});
  const available = eligibleBots.filter(bot => !(bot.id in (push?.settings.bots ?? {})));
  const changeMico = (botId: string, level: NotificationSettings["level"] | null) => {
    if (!push) return;
    const next = { ...push.settings.bots }; if (level === null) delete next[botId]; else next[botId] = level;
    void saveAccount({ bots: next });
  };
  const canTest = nativeStatus?.supported || permission === "granted";
  return <div className="rk-general-settings space-y-6">
    <SettingsGroup title={<span className="flex flex-wrap items-center gap-2">{t`What to notify you about`}<span className="rounded-full bg-accent px-2 py-0.5 text-xs font-normal">{t`All my devices`}</span></span>}>
      {!push ? <div className="px-4 py-3" role={loadError ? "alert" : "status"}>{loadError ? <>{t`Could not load account notification settings.`} <Button size="sm" variant="outline" onClick={() => setRetry(v => v + 1)}>{t`Retry`}</Button></> : t`Loading…`}</div> : <>
        <SettingsRow label={<span className="flex items-center gap-3"><Bell className="size-5" aria-hidden />Mycellios</span>}
          control={<LevelPicker label={t`Account notifications`} value={push.settings.level} disabled={busy !== null} onChange={level => void saveAccount({ level })} />} />
        {overrides.map(([botId, level]) => <SettingsRow key={botId}
          label={<span className="flex items-center gap-3"><BotAvatar color={bots.find(bot => bot.id === botId)?.color ?? "green"} identity={botId} size={28} />{eligibleBots.find(bot => bot.id === botId)?.name ?? t`Unavailable Mico`}</span>}
          control={<><LevelPicker label={`${t`Notifications`}: ${eligibleBots.find(bot => bot.id === botId)?.name ?? botId}`} value={level} disabled={busy !== null} onChange={next => changeMico(botId, next)} />
            <Button variant="ghost" size="icon" aria-label={`${t`Use account setting`}: ${eligibleBots.find(bot => bot.id === botId)?.name ?? botId}`} disabled={busy !== null} onClick={() => changeMico(botId, null)}><RotateCcw className="size-4" /></Button></>} />)}
        {available.length > 0 && <SettingsRow label={<span className="flex items-center gap-2 text-muted-foreground"><Plus className="size-4" aria-hidden />{t`Choose for a Mico`}</span>}
          control={<OptionSelect aria-label={t`Choose for a Mico`} value="" className="w-48 max-w-full" disabled={busy !== null}
            options={[{ value: "", label: t`Choose a Mico` }, ...available.map(bot => ({ value: bot.id, label: bot.name }))]}
            onValueChange={botId => { if (botId) changeMico(botId, push.settings.level); }} />} />}
        <SettingsRow label={accountPaused ? t`Notifications paused on all devices` : t`Pause on all devices`}
          control={<Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void saveAccount({ mutedUntil: accountPaused ? null : new Date(Date.now() + 3_600_000).toISOString() })}>{accountPaused ? t`Resume notifications` : t`Pause for 1 hour`}</Button>} />
        <SettingsRow label={<Label htmlFor={`${id}-push-preview`}>{t`Show push previews`}</Label>}
          description={t`Message content in background alerts on your devices. This device can hide it too.`}
          control={<Switch id={`${id}-push-preview`} checked={push.settings.previews} disabled={busy !== null} onCheckedChange={previews => void saveAccount({ previews })} />} />
        {loadError && <p role="alert" className="px-4 py-3 text-sm text-destructive">{t`Could not refresh. Showing the last loaded settings.`}</p>}
      </>}
    </SettingsGroup>
    <SettingsGroup title={t`This device`}>
      <SettingsRow label={<Label htmlFor={`${id}-enabled`}>{t`Desktop notifications`}</Label>}
        description={t`Show an alert when a Mico replies or needs your attention.`}
        control={<Switch id={`${id}-enabled`} data-testid="notification-enabled" checked={value.enabled} disabled={busy !== null} onCheckedChange={enabled => save({ enabled })} />} />
      <SettingsRow label={<Label htmlFor={`${id}-preview`}>{t`Show message previews`}</Label>}
        description={t`Hide previews to keep message content out of system notifications.`}
        control={<Switch id={`${id}-preview`} data-testid="notification-preview" checked={value.preview} disabled={!value.enabled || busy !== null} onCheckedChange={preview => save({ preview })} />} />
      <SettingsRow label={t`Test notification`} description={t`Request a notification now. Focus mode or Do Not Disturb may silence it.`}
        control={<>{nativeStatus?.settingsAvailable && <Button variant="ghost" size="sm" disabled={busy !== null}
          onClick={() => void action("system", async () => { if (!await native?.openSettings()) throw Error("Settings unavailable"); })}>{t`Open system notification settings`}</Button>}
          <Button variant="outline" size="sm" disabled={!canTest || !value.enabled || busy !== null} onClick={() => void action("test", async () => {
            await showSystemNotification("Mycellios", t`If you can see this alert, system notifications are enabled.`, "mycellios-settings-test", "/app", value.sound);
            if (activeScope.current === scope) setMessage(t`Test requested. Check your notification center; system focus or Do Not Disturb may silence it.`);
          })}>{t`Send test`}</Button></>} />
      {!nativeStatus?.supported && permission !== "granted" && <SettingsRow label={t`System permission`}
        description={permission === "denied" ? t`Allow notifications in your browser or system settings, then return here.` : t`Permission is requested only when you choose to enable notifications.`}
        control={permission === "default" ? <Button variant="outline" size="sm" disabled={!value.enabled || busy !== null} onClick={() => void action("permission", async () => {
          const next = await requestBrowserNotificationPermission(); if (activeScope.current !== scope) return;
          setPermission(next ?? "unsupported"); if (next !== "granted") throw Error("Permission unavailable");
          if (push?.publicKey) await enableWebPush(push.publicKey, scope);
        })}>{t`Enable notifications`}</Button> : <span className="text-sm text-muted-foreground">{permission === "denied" ? t`Blocked` : t`Not supported`}</span>} />}
      {push?.configured && !push.registered && permission === "granted" && environment !== "desktop" && environment !== "android-host" && <SettingsRow label={t`Background alerts`}
        control={<Button size="sm" variant="outline" disabled={busy !== null || !value.enabled} onClick={() => void action("register", async () => { if (!push.publicKey) throw Error("Not configured"); await enableWebPush(push.publicKey, scope); setRetry(v => v + 1); })}>{t`Connect this device`}</Button>} />}
      <SoundSettings embedded />
      <SettingsRow label={<Label htmlFor={`${id}-sound`}>{t`Notification sound`}</Label>}
        control={<Switch id={`${id}-sound`} checked={value.sound} disabled={!value.enabled || busy !== null} onCheckedChange={sound => save({ sound })} />} />
      <SettingsRow label={localPaused ? t`Paused on this device` : t`Pause on this device`}
        control={<Button variant="outline" size="sm" disabled={!value.enabled} onClick={() => { setNow(Date.now()); save({ mutedUntil: localPaused ? 0 : Date.now() + 3_600_000 }); }}>{localPaused ? t`Resume notifications` : t`Pause for 1 hour`}</Button>} />
      {value.attentionOnly && <SettingsRow label={t`Legacy device filter: only when needed`} description={t`Use the account filter above to keep the same behavior on all devices.`}
        control={<Button size="sm" variant="outline" onClick={() => save({ attentionOnly: false })}>{t`Use account setting`}</Button>} />}
    </SettingsGroup>
    <p className="px-1 text-xs text-muted-foreground" role="status">{
      environment === "desktop" ? t`Desktop alerts work while Mycellios is running. Fully quitting the app stops delivery on this computer.` :
      environment === "ios-install" ? t`On iPhone or iPad, add Mycellios to your Home Screen and open it there to enable background notifications.` :
      environment === "android-host" ? t`This Android build has no native background push. Install the web app from your browser for closed-app alerts.` :
      environment === "insecure" ? t`Open Mycellios over HTTPS to enable system notifications.` :
      push?.registered ? t`This device is registered for closed-app alerts. Delivery also depends on your system and network settings.` :
      push && !push.configured ? t`Background push is not configured on this server. Alerts are available only while the app is running.` : t`Enable system permission and register this device to receive background alerts.`
    }</p>
    {bots.length > 0 && <SettingsGroup title={t`Task alerts by Mico`}>
      <p className="px-4 py-3 text-xs text-muted-foreground">{t`Allow each Mico to send task alerts. Account and device filters still apply.`}</p>
      {bots.map(bot => <SettingsRow key={bot.id} label={<span className="flex items-center gap-3"><BotAvatar color={bot.color} size={28} />{bot.name}</span>}
        control={<Switch aria-label={`${t`Task alerts`}: ${bot.name}`} checked={bot.notifyOnFinish} disabled={!onUpdate || busy !== null}
          onCheckedChange={enabled => void action(bot.id, async () => { await onUpdate?.(bot.id, enabled); })} />} />)}
    </SettingsGroup>}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
  </div>;
}

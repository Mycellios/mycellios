import { SoundSettings } from "./SoundSettings";
import { useLingui } from "@lingui/react/macro";
import type { Bot, NotificationSettings } from "@rakazo/contracts";
import { Button, Label, Switch, NativeSelect } from "@rakazo/ui-web";
import { Disclosure } from "@rakazo/ui-web/components/ui/disclosure";
import { useCallback, useEffect, useId, useState, useSyncExternalStore } from "react";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { rpc } from "../../lib/rpc";
import { enableWebPush, isInstalledWebApp, notificationClientId, pushSupported } from "../../lib/web-push";
import { desktopBridge } from "../../lib/desktop";
import { androidNotificationRequest, isAndroidHost, type AndroidNotificationStatus } from "../../lib/android-host";
import { notificationEnvironment } from "../../lib/notification-environment";
import { requestBrowserNotificationPermission, showSystemNotification } from "../../lib/browser-notifications";
import {
  notificationPreferences,
  notificationSnapshot,
  saveNotificationPreferences,
  subscribeNotifications,
} from "../../lib/notification-preferences";

export function NotificationsPanel({
  scope,
  bots = [],
  onUpdate,
  onBusyChange,
}: {
  scope: string;
  bots?: Bot[];
  onUpdate?: (id: string, enabled: boolean) => Promise<void>;
  onBusyChange?: (value: boolean) => void;
}) {
  const { t } = useLingui();
  const id = useId();
  useSyncExternalStore(
    useCallback((listener) => subscribeNotifications(scope, listener), [scope]),
    useCallback(() => notificationSnapshot(scope), [scope]),
    () => "",
  );
  const value = notificationPreferences(scope);
  const [now, setNow] = useState(Date.now);
  const paused = value.mutedUntil > now;
  useEffect(() => {
    if (!paused) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(
      Math.max(0, value.mutedUntil - Date.now()) + 1, 3_600_001,
    ));
    return () => window.clearTimeout(timer);
  }, [paused, value.mutedUntil]);
  const supported = typeof Notification !== "undefined";
  const android = isAndroidHost();
  const [androidStatus, setAndroidStatus] = useState<AndroidNotificationStatus>();
  const [androidServer, setAndroidServer] = useState<boolean | null>(null);
  const [permission, setPermission] = useState(() =>
    supported ? Notification.permission : "unsupported",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const native = desktopBridge()?.notifications;
  const [nativeStatus, setNativeStatus] = useState<{ supported: boolean; settingsAvailable: boolean }>();
  const [pushConfigured, setPushConfigured] = useState<boolean | null>(null);
  const [pushError, setPushError] = useState(false);
  useEffect(() => {
    if (!android || !scope) return;
    let disposed = false;
    const sync = () => void Promise.all([androidNotificationRequest("status", { accountId: scope }), rpc.notifications.androidStatus()]).then(([status, service]) => {
      if (!disposed) { setAndroidStatus(status); setPermission(status.permission); setAndroidServer(service.configured); }
    }).catch(() => { if (!disposed) setError(t`Update Mycellios Android to configure native notifications.`); });
    sync(); window.addEventListener("focus", sync); window.addEventListener("mycellios:notifications-changed", sync);
    return () => { disposed = true; window.removeEventListener("focus", sync); window.removeEventListener("mycellios:notifications-changed", sync); };
  }, [android, scope]);
  const environment = notificationEnvironment({ userAgent: navigator.userAgent, platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints, secure: window.isSecureContext, installed: isInstalledWebApp(),
    push: pushSupported(), androidHost: isAndroidHost(), nativeDesktop: Boolean(desktopBridge()) });
  useEffect(() => { let disposed = false;
    void native?.status().then(state => { if (!disposed) setNativeStatus(state); }).catch(() => undefined);
    return () => { disposed = true; };
  }, [native]);
  const [push, setPush] = useState<{ publicKey: string | null; registered: boolean; settings: NotificationSettings }>();
  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    const refresh = () => void rpc.notifications.webStatus({ clientId: notificationClientId() })
      .then((state) => { if (!cancelled) { setPushError(false); setPushConfigured(state.configured); setPush(state); } })
      .catch(() => { if (!cancelled) { setPushError(true); setPushConfigured(null); setPush(undefined); } });
    refresh();
    window.addEventListener("mycellios:notifications-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => { cancelled = true; window.removeEventListener("mycellios:notifications-changed", refresh); window.removeEventListener("focus", refresh); };
  }, [scope]);
  async function savePushSettings(patch: Partial<NotificationSettings>) {
    if (!push || busy) return;
    setBusy("push-settings");
    setError("");
    try {
      const settings = await rpc.notifications.saveSettings({ ...push.settings, ...patch });
      setPush({ ...push, settings });
      window.dispatchEvent(new Event("mycellios:notifications-changed"));
    } catch {
      setError(t`Could not save this preference.`);
    } finally {
      setBusy(null);
    }
  }
  useEffect(() => {
    onBusyChange?.(busy !== null);
  }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  useEffect(() => {
    const sync = () =>
      { if (!android) setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission); };
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, [android]);
  function save(patch: Partial<typeof value>) {
    try {
      saveNotificationPreferences(scope, { ...value, ...patch });
      setError("");
    } catch {
      setError(t`Could not save this preference.`);
    }
  }
  async function allow() {
    setBusy("permission");
    setError("");
    try {
      if (android) {
        const service = await rpc.notifications.androidStatus();
        if (!service.configured) throw new Error(t`Android push is not configured on this server.`);
        const status = await androidNotificationRequest("enable", { accountId: scope });
        setAndroidStatus(status); setPermission(status.permission);
        window.dispatchEvent(new Event("mycellios:notifications-changed")); return;
      }
      const next = await requestBrowserNotificationPermission();
      setPermission(next ?? "unsupported");
      if (next === "granted" && push?.publicKey) {
        await enableWebPush(push.publicKey, scope);
      }
    } catch (cause) {
      setError(android && cause instanceof Error ? cause.message : t`Could not enable notifications.`);
    } finally {
      setBusy(null);
    }
  }
  async function toggle(id: string, enabled: boolean) {
    if (!onUpdate || busy) return;
    setBusy(id);
    setError("");
    try {
      await onUpdate(id, enabled);
      setMessage(t`Saved`);
    } catch {
      setError(t`Could not save this preference.`);
    } finally {
      setBusy(null);
    }
  }
  async function sendTest() {
    setBusy("test");
    setMessage("");
    setError("");
    try {
      if (android) await androidNotificationRequest("test", { accountId: scope });
      else await showSystemNotification("Mycellios", t`If you can see this alert, system notifications are enabled.`,
        "mycellios-settings-test", "/app", value.sound);
      setMessage(t`Test requested. Check your notification center; system focus or Do Not Disturb may silence it.`);
    } catch {
      setError(t`Could not show the test notification.`);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="rk-general-settings space-y-6">
      <SettingsGroup title={t`This device`}>
        <SettingsRow label={t`Delivery`} control={<span className="text-sm text-muted-foreground">{
          environment === "desktop" ? t`Desktop` : android ? androidStatus?.registered && androidServer ? t`Push connected` : t`Setup needed` : pushError ? t`Unavailable` : push?.registered ? t`Push connected` : t`Setup needed`
        }</span>}>
          <p className="text-xs text-muted-foreground">{
            environment === "desktop" ? t`Desktop alerts work while Mycellios is running. Fully quitting the app stops delivery on this computer.` :
            environment === "ios-install" ? t`On iPhone or iPad, add Mycellios to your Home Screen and open it there to enable background notifications.` :
            environment === "android-host" ? androidStatus?.configured && androidServer ? t`Native Android alerts use Firebase and open the corresponding chat. Enable system permission to register this device.` : t`Firebase must be configured in the Android app and on the server before native push can be enabled.` :
            environment === "insecure" ? t`Open Mycellios over HTTPS to enable system notifications.` :
            pushError ? t`Could not check background delivery. Alerts in the running app remain available.` :
            push?.registered ? t`This device is registered for closed-app alerts. Delivery also depends on your system and network settings.` :
            pushConfigured === false ? t`Background push is not configured on this server. Alerts are available only while the app is running.` :
            t`Enable system permission and register this device to receive background alerts.`
          }</p>
          {nativeStatus?.settingsAvailable && <Button variant="ghost" size="sm" className="mt-2" onClick={() => {
            void native?.openSettings().catch(() => setError(t`Could not open system notification settings.`));
          }}>{t`Open system notification settings`}</Button>}
          {android && <Button variant="ghost" size="sm" className="mt-2" onClick={() => { void androidNotificationRequest("settings").catch(() => setError(t`Could not open system notification settings.`)); }}>{t`Open system notification settings`}</Button>}
        </SettingsRow>
        <SettingsRow
          label={<Label htmlFor={`${id}-enabled`}>{t`Reply notifications`}</Label>}
          control={
            <Switch
              id={`${id}-enabled`}
              data-testid="notification-enabled"
              checked={value.enabled}
              onCheckedChange={(enabled) => save({ enabled })}
            />
          }
        >
          <p className="text-xs text-muted-foreground">{push?.publicKey
            ? t`Receive alerts on this device even when Mycellios is closed. They open the corresponding chat.`
            : t`Notify you about Mico replies while this app is open in the background.`}</p>
        </SettingsRow>
        <SettingsRow
          label={<Label htmlFor={`${id}-preview`}>{t`Show message previews`}</Label>}
          control={
            <Switch
              id={`${id}-preview`}
              data-testid="notification-preview"
              checked={value.preview}
              disabled={!value.enabled}
              onCheckedChange={(preview) => save({ preview })}
            />
          }
        >
          <p className="text-xs text-muted-foreground">{t`Hide previews to keep message content out of system notifications.`}</p>
        </SettingsRow>
        <SettingsRow
          label={<Label htmlFor={`${id}-sound`}>{t`Notification sound`}</Label>}
          control={
            <Switch
              id={`${id}-sound`}
              checked={value.sound}
              disabled={!value.enabled}
              onCheckedChange={(sound) => save({ sound })}
            />
          }
        />
        {(permission !== "granted" || android && !androidStatus?.registered) && <SettingsRow
          label={t`System permission`}
          control={
            permission === "default" || android && permission === "granted" && !androidStatus?.registered ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null || !value.enabled}
                onClick={() => void allow()}
              >{t`Enable notifications`}</Button>
            ) : (
              <span className="text-sm text-muted-foreground">
                {permission === "granted"
                  ? t`Allowed`
                  : permission === "denied"
                    ? t`Blocked`
                    : t`Not supported`}
              </span>
            )
          }
        >
          <p className="text-xs text-muted-foreground">
            {permission === "denied"
              ? t`Allow notifications in your browser or system settings, then return here.`
              : permission === "unsupported"
                ? t`This environment does not support system notifications.`
                : t`Permission is requested only when you choose to enable notifications.`}
          </p>
        </SettingsRow>
        }
        {(permission === "granted" && (!android || androidStatus?.registered)) || nativeStatus?.supported ? (
          <SettingsRow
            label={t`Test notification`}
            control={
              <Button
                variant="outline"
                size="sm"
                disabled={!value.enabled || busy !== null}
                onClick={() => void sendTest()}
              >{t`Send test`}</Button>
            }
          />
        ) : null}
      </SettingsGroup>
      <SoundSettings />
      <Disclosure summary={t`More notification settings`} className="rk-settings-details" summaryClassName="w-full py-2 text-sm text-muted-foreground">
        <SettingsGroup>
        <SettingsRow
          label={<Label htmlFor={`${id}-attention`}>{t`Only when I’m needed`}</Label>}
          control={<Switch id={`${id}-attention`} checked={value.attentionOnly}
            disabled={!value.enabled} onCheckedChange={(attentionOnly) => save({ attentionOnly })} />}
        >
          <p className="text-xs text-muted-foreground">{t`Get notified when a Mico needs your answer or approval.`}</p>
        </SettingsRow>
        <SettingsRow
          label={t`Pause notifications`}
          control={<Button variant="outline" size="sm" disabled={!value.enabled}
            onClick={() => {
              setNow(Date.now());
              save({ mutedUntil: paused ? 0 : Date.now() + 3_600_000 });
            }}>{paused ? t`Resume notifications` : t`Pause for 1 hour`}</Button>}
        />
        </SettingsGroup>
      </Disclosure>
      {push && <Disclosure summary={t`Background alerts across devices`} className="rk-settings-details" summaryClassName="w-full py-2 text-sm text-muted-foreground">
        <SettingsGroup>
          <SettingsRow label={<Label htmlFor={`${id}-push-level`}>{t`When to notify`}</Label>} control={
            <NativeSelect id={`${id}-push-level`} value={push.settings.level} disabled={busy !== null}
              onChange={event => void savePushSettings({ level: event.target.value as NotificationSettings["level"] })}>
              <option value="all">{t`All activity`}</option><option value="needs_me">{t`Only when I’m needed`}</option><option value="off">{t`Off`}</option>
            </NativeSelect>}>
            <p className="text-xs text-muted-foreground">{t`Applies to all devices where you enabled closed-app notifications.`}</p>
          </SettingsRow>
          <SettingsRow label={<Label htmlFor={`${id}-push-preview`}>{t`Show push previews`}</Label>} control={
            <Switch id={`${id}-push-preview`} checked={push.settings.previews} disabled={busy !== null}
              onCheckedChange={previews => void savePushSettings({ previews })}/>} />
          <SettingsRow label={t`Pause notifications`} control={<Button variant="outline" size="sm" disabled={busy !== null}
            onClick={() => void savePushSettings({ mutedUntil: push.settings.mutedUntil && Date.parse(push.settings.mutedUntil) > Date.now() ? null : new Date(Date.now() + 3_600_000).toISOString() })}>
            {push.settings.mutedUntil && Date.parse(push.settings.mutedUntil) > now ? t`Resume notifications` : t`Pause for 1 hour`}
          </Button>}/>
          {bots.map(bot => <SettingsRow key={bot.id} label={<Label htmlFor={`${id}-push-${bot.id}`}>{bot.name}</Label>} control={
            <NativeSelect id={`${id}-push-${bot.id}`} disabled={busy !== null} value={push.settings.bots[bot.id] ?? "inherit"}
              onChange={event => { const overrides = { ...push.settings.bots }; if (event.target.value === "inherit") delete overrides[bot.id]; else overrides[bot.id] = event.target.value as NotificationSettings["level"]; void savePushSettings({ bots: overrides }); }}>
              <option value="inherit">{t`Use account setting`}</option><option value="all">{t`All activity`}</option><option value="needs_me">{t`Only when I’m needed`}</option><option value="off">{t`Off`}</option>
            </NativeSelect>} />)}
        </SettingsGroup>
      </Disclosure>}
      <Disclosure summary={t`Notifications by Mico`} className="rk-settings-details" summaryClassName="w-full py-2 text-sm text-muted-foreground">
      <SettingsGroup>
        {bots.length ? (
          bots.map((bot) => (
            <SettingsRow
              key={bot.id}
              label={<Label htmlFor={`${id}-${bot.id}`}>{bot.name}</Label>}
              control={
                <Switch
                  id={`${id}-${bot.id}`}
                  checked={bot.notifyOnFinish}
                  disabled={!onUpdate || busy !== null}
                  onCheckedChange={(enabled) => void toggle(bot.id, enabled)}
                />
              }
            />
          ))
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">{t`No Micos in this space.`}</p>
        )}
      </SettingsGroup>
      </Disclosure>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}

import { useLingui } from "@lingui/react/macro";
import type { Bot, NotificationSettings } from "@rakazo/contracts";
import { Button, Label, Switch } from "@rakazo/ui-web";
import { useCallback, useEffect, useId, useState, useSyncExternalStore } from "react";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { rpc } from "../../lib/rpc";
import { enableWebPush, notificationClientId, pushSupported } from "../../lib/web-push";
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
  const [permission, setPermission] = useState(() =>
    supported ? Notification.permission : "unsupported",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [push, setPush] = useState<{ publicKey: string | null; registered: boolean; settings: NotificationSettings }>();
  useEffect(() => {
    if (!scope || !pushSupported()) return;
    let cancelled = false;
    const refresh = () => void rpc.notifications.webStatus({ clientId: notificationClientId() })
      .then((state) => { if (!cancelled && state.configured) setPush(state); })
      .catch(() => undefined);
    refresh();
    window.addEventListener("mycellios:notifications-changed", refresh);
    return () => { cancelled = true; window.removeEventListener("mycellios:notifications-changed", refresh); };
  }, [scope]);
  async function savePushSettings(patch: Partial<NotificationSettings>) {
    if (!push || busy) return;
    setBusy("push-settings");
    setError("");
    try {
      const settings = await rpc.notifications.saveSettings({ ...push.settings, ...patch });
      setPush({ ...push, settings });
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
      setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, []);
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
      const next = await requestBrowserNotificationPermission();
      setPermission(next ?? "unsupported");
      if (next === "granted" && push?.publicKey) {
        await enableWebPush(push.publicKey, scope);
      }
    } catch {
      setError(t`Could not enable notifications.`);
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
      await showSystemNotification("Mycellios", t`Notifications are working on this device.`,
        "mycellios-settings-test", "/app", value.sound);
      setMessage(t`Test notification sent.`);
    } catch {
      setError(t`Could not show the test notification.`);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-6">
      <SettingsGroup title={t`This device`}>
        {push?.registered && <SettingsRow
          label={<Label htmlFor={`${id}-push-attention`}>{t`Push alerts only when I’m needed`}</Label>}
          control={<Switch id={`${id}-push-attention`} checked={push.settings.level === "needs_me"}
            disabled={busy !== null} onCheckedChange={(on) => void savePushSettings({ level: on ? "needs_me" : "all" })} />}
        >
          <p className="text-xs text-muted-foreground">{t`Applies to all devices where you enabled closed-app notifications.`}</p>
        </SettingsRow>}
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
        <SettingsRow
          label={t`System permission`}
          control={
            permission === "default" ? (
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
        {permission === "granted" ? (
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
      <SettingsGroup title={t`Micos in this space`}>
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

import { useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import { Button, Label, Switch } from "@rakazo/ui-web";
import { useCallback, useEffect, useId, useState, useSyncExternalStore } from "react";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { requestBrowserNotificationPermission } from "../../lib/browser-notifications";
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
  const supported = typeof Notification !== "undefined";
  const [permission, setPermission] = useState(() =>
    supported ? Notification.permission : "unsupported",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
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
  return (
    <div className="space-y-6">
      <SettingsGroup title={t`This device`}>
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
          <p className="text-xs text-muted-foreground">{t`Notify you about Mico replies while this app is open in the background.`}</p>
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
                disabled={!value.enabled}
                onClick={() => {
                  try {
                    const test = new Notification("Mycellios", {
                      body: t`Notifications are working on this device.`,
                      tag: "mycellios-settings-test",
                    });
                    setTimeout(() => test.close(), 5000);
                    setError("");
                    setMessage(t`Test notification sent.`);
                  } catch {
                    setError(t`Could not show the test notification.`);
                  }
                }}
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

import { useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { useState } from "react";
import { requestBrowserNotificationPermission } from "../lib/browser-notifications";
import { notificationPreferences } from "../lib/notification-preferences";
import { enableWebPush, isInstalledWebApp, pushSupported } from "../lib/web-push";

export function PushPermissionPrompt({ accountId, publicKey }: { accountId: string; publicKey: string }) {
  const { t } = useLingui();
  const key = `mycellios:push-prompt-dismissed:${accountId}`;
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(key) === "1"; } catch { return false; }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (dismissed || !isInstalledWebApp() || !pushSupported() ||
    !notificationPreferences(accountId).enabled || (Notification.permission !== "default" && !busy && !error)) return null;

  async function allow() {
    setBusy(true);
    setError(false);
    try {
      if (await requestBrowserNotificationPermission() === "granted") await enableWebPush(publicKey, accountId);
      setDismissed(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  function dismiss() {
    try { localStorage.setItem(key, "1"); } catch { /* Honor dismissal for the current chat. */ }
    setDismissed(true);
  }
  return (
    <aside className="pointer-events-auto mx-3 mb-2 rounded-xl border border-border bg-background px-4 py-3" aria-label={t`Reply notifications`}>
      <p className="text-sm font-semibold">{t`Get notified when your Mico replies`}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t`You’ll get an alert even when Mycellios is closed.`}</p>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{t`Could not enable notifications.`}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" className="min-h-11" onClick={() => void allow()} disabled={busy}>
          {busy ? t`Enabling…` : error ? t`Try again` : t`Allow notifications`}
        </Button>
        <Button variant="ghost" size="sm" className="min-h-11" onClick={dismiss} disabled={busy}>{t`Not now`}</Button>
      </div>
    </aside>
  );
}

import { useLingui } from "@lingui/react/macro";
import { isBuildId } from "@rakazo/contracts/client-build";
import { Button } from "@rakazo/ui-web";
import { useState, useSyncExternalStore } from "react";
import { DesktopUpdateSection } from "../../components/DesktopUpdates";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { CLIENT_BUILD } from "../../lib/client-build";
import { clientUpdates } from "../../lib/client-update";
import { desktopBridge } from "../../lib/desktop";

export function UpdatesPanel({
  onWhatsNew,
  onClose,
}: {
  onWhatsNew?: () => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const updates = clientUpdates();
  const available = useSyncExternalStore(updates.subscribe, updates.getSnapshot, () => null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function check() {
    setBusy(true);
    setError("");
    try {
      const served = await updates.checkForUpdates();
      if (!served || !isBuildId(served)) setError(t`Could not check for updates. Try again.`);
      else setResult(served);
    } catch {
      setError(t`Could not check for updates. Try again.`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <SettingsGroup title={t`Mycellios updates`}>
        <SettingsRow
          label={t`Release notes`}
          control={
            <Button
              variant="outline"
              disabled={!onWhatsNew}
              onClick={onWhatsNew}
            >{t`What's new`}</Button>
          }
        />
        <SettingsRow
          label={t`Version history`}
          control={
            <a
              className="text-sm underline underline-offset-4"
              href="https://github.com/Mycellios/mycellios/releases"
              target="_blank"
              rel="noopener noreferrer"
            >{t`Published releases on GitHub`}</a>
          }
        />
        <SettingsRow
          label={t`Web app version`}
          control={
            <span className="font-mono text-xs text-muted-foreground">
              {isBuildId(CLIENT_BUILD) ? CLIENT_BUILD : t`Development preview`}
            </span>
          }
        >
          <p className="text-xs text-muted-foreground">{t`Web updates are delivered by the server. They wait while you have drafts, attachments, calls or settings open.`}</p>
        </SettingsRow>
        <SettingsRow
          label={t`Check web updates`}
          control={
            <Button
              variant="outline"
              onClick={() => void check()}
              disabled={busy || !isBuildId(CLIENT_BUILD)}
            >
              {busy ? t`Checking…` : t`Check for updates`}
            </Button>
          }
        />
        {available ? (
          <SettingsRow
            label={t`Update available`}
            control={<Button onClick={onClose}>{t`Return to app`}</Button>}
          >
            <p className="text-sm text-muted-foreground">{t`Close settings and use the update prompt. Your unfinished work remains protected.`}</p>
          </SettingsRow>
        ) : result && !error ? (
          <p role="status" className="px-4 py-3 text-sm text-muted-foreground">{t`Up to date`}</p>
        ) : null}
      </SettingsGroup>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {desktopBridge()?.update ? (
        <>
          <DesktopUpdateSection />
          <p className="text-xs text-muted-foreground">{t`Desktop updates follow the policy of your installed package. Manual installations use the published downloads.`}</p>
          <a
            href="https://www.mycellios.com/downloads/desktop"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm underline underline-offset-4"
          >{t`Download Mycellios Desktop`}</a>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t`Desktop app updates are managed in the installed app.`}</p>
      )}
    </div>
  );
}

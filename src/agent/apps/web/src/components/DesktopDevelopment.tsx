import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { useRef, useState } from "react";
import { appRoute } from "../lib/app-path";
import { desktopBridge } from "../lib/desktop";
import { rpc } from "../lib/rpc";
import { SettingsRow } from "./SettingsRows";

export function DesktopDevelopment() {
  const { t } = useLingui();
  const desktop = desktopBridge();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const pending = useRef(false);
  if (!desktop?.development?.open || desktop.development.isDevelopment) return null;
  async function open() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(false);
    try {
      if (!(await desktop!.computer?.requestAccess())) return;
      const botId = appRoute(window.location.pathname).match(/^\/app\/([^/]+)\/?$/)?.[1];
      if (botId) {
        const bots = await rpc.bots.list();
        if (
          bots.some(
            (bot) =>
              bot.id === botId &&
              ["queued", "leased", "running", "waiting_input", "waiting_takeover"].includes(
                bot.status,
              ),
          )
        )
          throw new Error("Wait for the agent to become idle.");
        await rpc.bots.setComputer({ botId, mode: "dedicated" });
      }
      const result = await desktop!.development!.open!(botId);
      if (!result.opened || result.error) throw new Error();
    } catch {
      setError(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <SettingsRow
      label={<Trans>Development window</Trans>}
      control={
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          aria-busy={busy}
          onClick={() => void open()}
        >
          {busy ? t`Preparing development…` : t`Open development`}
        </Button>
      }
    >
      <p className="text-xs text-muted-foreground">
        <Trans>
          A separate local copy with live interface updates. The stable window stays open. Changes
          stay on this computer.
        </Trans>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        <Trans>
          The first launch prepares the source and downloads development tools automatically.
        </Trans>
      </p>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          <Trans>
            Could not prepare development. Check the connection and try again when the agent is
            idle.
          </Trans>
        </p>
      )}
    </SettingsRow>
  );
}

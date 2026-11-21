import { useLingui } from "@lingui/react/macro";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@rakazo/ui-web";
import { useState } from "react";
import { useSpaceRpc } from "../lib/space-rpc";

type Outcome = "done" | "computer_off" | "busy" | "failed";

/**
 * Sign the Mico out of every website: close its browser and delete its profile on the server
 * computers it uses. The owner's own PC is never touched.
 */
export function BotBrowserReset({ botId }: { botId: string }) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function reset() {
    setBusy(true);
    setOutcome(null);
    try {
      const result = await rpc.bots.resetBrowser({ botId });
      setOutcome(result.computerOff ? "computer_off" : "done");
      setOpen(false);
    } catch (error) {
      setOutcome((error as { code?: string } | null)?.code === "CONFLICT" ? "busy" : "failed");
    } finally {
      setBusy(false);
    }
  }

  const message =
    outcome === "done"
      ? t`The Mico is signed out of every website.`
      : outcome === "computer_off"
        ? t`Its computer is off, so it still has its sessions there. Try again when the computer is on.`
        : null;
  const error =
    outcome === "busy"
      ? t`The Mico is working. Try again when it finishes.`
      : outcome === "failed"
        ? t`Could not close the sessions. Try again.`
        : null;

  return (
    <div className="mt-4 text-sm text-foreground">
      {t`Browser sessions`}
      <p className="mt-1 text-xs text-muted-foreground">
        {t`Sign this Mico out of every website. Its next task starts with an empty browser.`}
      </p>
      <Button variant="outline" size="sm" className="mt-2" onClick={() => { setOutcome(null); setOpen(true); }}>
        {t`Close browser sessions`}
      </Button>
      {message ? <p role="status" className="mt-2 text-xs text-muted-foreground">{message}</p> : null}
      {error && !open ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
      <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
        <DialogContent className="max-w-md">
          <DialogTitle>{t`Close browser sessions?`}</DialogTitle>
          <DialogDescription>
            {t`The Mico loses its logins, cookies and saved site data. It will need to sign in again to use those websites.`}
          </DialogDescription>
          {error ? <p role="alert" className="text-[13px] text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>{t`Cancel`}</Button>
            <Button variant="destructive" disabled={busy} aria-busy={busy} onClick={() => void reset()}>
              {busy ? t`Closing…` : t`Close sessions`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

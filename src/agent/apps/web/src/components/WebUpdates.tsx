import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { clientUpdates } from "../lib/client-update";
import { desktopBridge } from "../lib/desktop";
import { useWebUpdateSlot } from "./web-update-slot";

/** Browser and installed PWA share the same safe, server-verified update path. */
export function WebUpdates() {
  const updates = clientUpdates();
  const ready = useSyncExternalStore(updates.subscribe, updates.getSnapshot, () => null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const { t } = useLingui();
  const slot = useWebUpdateSlot();
  if (!ready || ready === dismissed || desktopBridge()) return null;
  const notice = (
    <aside
      aria-label={t`New version available`}
      aria-live="polite"
      className={
        slot
          ? "mx-2.5 mt-2 min-w-0 rounded-xl border border-border bg-sidebar-accent p-3 text-foreground"
          : "fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 w-[min(24rem,calc(100vw-2rem))] min-w-0 rounded-xl border border-border bg-card p-4 text-card-foreground"
      }
    >
      <p className="text-sm font-medium">
        <Trans>New version available</Trans>
      </p>
      <details className="mt-1 text-xs text-muted-foreground">
        <summary className="cursor-pointer">
          <Trans>About this update</Trans>
        </summary>
        <p className="mt-1">
          <Trans>
            Your chats stay saved. Tasks running on the server will continue while Mycellios
            refreshes.
          </Trans>
        </p>
      </details>
      {error && (
        <p role="status" className="mt-2 text-sm">
          <Trans>
            Send your draft and attachments, finish any call or recording, and close edited forms
            before updating. If it still fails, try again when connected.
          </Trans>
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => setDismissed(ready)}>
          <Trans>Not now</Trans>
        </Button>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(false);
            try {
              if (!(await updates.applyUpdate())) setError(true);
            } catch {
              setError(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Trans>Updating…</Trans> : <Trans>Update</Trans>}
        </Button>
      </div>
    </aside>
  );
  return slot ? createPortal(notice, slot) : notice;
}

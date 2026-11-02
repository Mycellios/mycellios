import { Trans, useLingui } from "@lingui/react/macro";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@rakazo/ui-web";
import { useEffect, useRef, useState } from "react";
import { CLIENT_BUILD } from "../lib/client-build";
import { getSnapshot as activeCall } from "../lib/call-session";
import { dictation } from "../lib/dictation";
import {
  acknowledgeRelease,
  browserStorage,
  observeRelease,
  RELEASE_NOTES,
} from "../lib/release-notes";
import { AuthMushroom } from "./AuthMushroom";

/** Mounted with the signed-in sidebar, never on login or before the new bundle loads. */
export function ReleaseNotes({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const { i18n } = useLingui();
  const observed = useRef<ReturnType<typeof observeRelease> | undefined>(undefined);
  const [previousBuild, setPreviousBuild] = useState<string | null>(null);
  useEffect(() => {
    observed.current ??= observeRelease(
      CLIENT_BUILD,
      browserStorage("localStorage"),
      browserStorage("sessionStorage"),
    );
    const observation = observed.current;
    setPreviousBuild(observation?.previousBuild ?? null);
    if (!observation?.show) return;
    // Don't stack the announcement over another modal or an active recording.
    const show = () => {
      if (!observation.show) return true;
      if (
        document.visibilityState === "hidden" ||
        activeCall() ||
        dictation.state.status !== "idle" ||
        document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]')
      )
        return false;
      onOpenChange(true);
      return true;
    };
    if (show()) return;
    const timer = setInterval(() => {
      if (show()) clearInterval(timer);
    }, 1500);
    return () => clearInterval(timer);
  }, [onOpenChange]);
  function close(value: boolean) {
    if (!value) {
      acknowledgeRelease(browserStorage("localStorage"));
      if (observed.current) observed.current.show = false;
    }
    onOpenChange(value);
  }
  const date = new Intl.DateTimeFormat(i18n?.locale || "en", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(RELEASE_NOTES.date + "T12:00:00Z"));
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-lg"
        data-testid="release-notes-dialog"
      >
        <DialogHeader className="items-center px-6 pb-5 pt-7 text-center">
          <AuthMushroom />
          <DialogTitle className="mt-3">
            <Trans>What's new in Mycellios</Trans>
          </DialogTitle>
          <DialogDescription className="text-center">
            {previousBuild && previousBuild !== CLIENT_BUILD ? (
              <>
                <Trans>Updated</Trans> ·{" "}
              </>
            ) : null}
            {RELEASE_NOTES.version} · {date}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-6 pb-6" data-testid="release-notes-content">
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
              <Trans context="release-notes">New</Trans>
              <span className="rounded-full bg-primary/10 px-1.5 tabular-nums">2</span>
            </h3>
            <ul className="list-disc space-y-3 ps-4 text-sm leading-relaxed marker:text-primary">
              <li>
                <Trans>
                  Add Mycellios to your phone from the sidebar, with simple steps for iPhone and
                  Android.
                </Trans>
              </li>
              <li>
                <Trans>
                  See a short summary of what changed after an update. Reopen it anytime from your
                  account menu.
                </Trans>
              </li>
            </ul>
          </section>
          <section className="mt-6">
            <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
              <Trans>Improved</Trans>
              <span className="rounded-full bg-primary/10 px-1.5 tabular-nums">2</span>
            </h3>
            <ul className="list-disc space-y-3 ps-4 text-sm leading-relaxed marker:text-primary">
              <li>
                <Trans>Update notices are easier to find in the sidebar.</Trans>
              </li>
              <li>
                <Trans>
                  Updating keeps your saved chats and waits for unsent drafts, attachments and
                  calls.
                </Trans>
              </li>
            </ul>
          </section>
        </div>
        <div className="flex justify-end border-t border-border bg-muted/30 px-5 py-3">
          <Button onClick={() => close(false)}>
            <Trans>Got it</Trans>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

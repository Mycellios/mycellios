import { Trans, useLingui } from "@lingui/react/macro";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@rakazo/ui-web";
import { ChevronDown, ExternalLink, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getSnapshot as activeCall } from "../lib/call-session";
import { CLIENT_BUILD } from "../lib/client-build";
import { dictation } from "../lib/dictation";
import {
  acknowledgeRelease,
  browserStorage,
  LATEST_RELEASE,
  observeRelease,
  type Release,
  type ReleaseGroupType,
  releaseEntry,
  releaseForBuild,
  selectReleases,
  summarizeReleases,
} from "../lib/release-notes";
import { AuthMushroom } from "./AuthMushroom";

export const CHANGELOG_URL = "https://www.mycellios.com/changelog";
/** A longer fix list starts closed, so the new features stay in view. */
const OPEN_FIX_LIMIT = 3;

/**
 * The notes of the versions since the last one this device ran, after an update.
 * Mounted with the signed-in sidebar, never on login or before the new bundle
 * loads. It never blocks the app: Escape, the overlay and "Got it" close it.
 */
export function ReleaseNotes({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const observed = useRef<ReturnType<typeof observeRelease> | undefined>(undefined);
  const [automatic, setAutomatic] = useState<{ releases: Release[]; previousBuild: string | null } | null>(null);
  useEffect(() => {
    observed.current ??= observeRelease(
      CLIENT_BUILD,
      browserStorage("localStorage"),
      browserStorage("sessionStorage"),
    );
    const observation = observed.current;
    if (!observation?.show) return;
    setAutomatic({ releases: observation.releases, previousBuild: observation.previousBuild });
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

  // Opened by hand (Help > What's new): the notes of the version that runs now.
  const manual = CLIENT_BUILD ? selectReleases(CLIENT_BUILD, null) : [LATEST_RELEASE];
  const pending = observed.current?.show ? automatic : null;
  const releases = pending?.releases ?? manual;
  const from = pending ? releaseForBuild(pending.previousBuild) : null;

  function close(value: boolean) {
    if (!value) {
      acknowledgeRelease(browserStorage("localStorage"), releases[0]?.version);
      if (observed.current) observed.current.show = false;
    }
    onOpenChange(value);
  }
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
            <VersionLine to={releases[0] ?? null} from={from} />
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-6 overflow-y-auto px-6 pb-6" data-testid="release-notes-content">
          <ReleaseBody releases={releases} />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-3">
          <Button variant="ghost" nativeButton={false} render={<a href={CHANGELOG_URL} target="_blank" rel="noreferrer" />}>
            <Trans>Full changelog</Trans>
            <ExternalLink aria-hidden="true" />
          </Button>
          <Button onClick={() => close(false)} autoFocus>
            <Trans>Got it</Trans>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VersionLine({ to, from }: { to: Release | null; from: Release | null }) {
  const { i18n } = useLingui();
  if (!to) return null;
  const date = new Intl.DateTimeFormat(i18n?.locale || "en", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(to.date + "T12:00:00Z"),
  );
  const toVersion = to.version;
  const fromVersion = from?.version;
  return (
    <>
      {fromVersion && fromVersion !== toVersion ? (
        <Trans>Updated from {fromVersion} to {toVersion}</Trans>
      ) : (
        <Trans>Version {toVersion}</Trans>
      )}
      <span aria-hidden="true"> · </span>
      <time dateTime={to.date}>{date}</time>
    </>
  );
}

export function ReleaseBody({ releases }: { releases: readonly Release[] }) {
  const { i18n } = useLingui();
  const summary = summarizeReleases(releases);
  if (summary.notices.length === 0 && summary.groups.length === 0)
    return (
      <div className="py-6 text-center">
        <h3 className="font-medium"><Trans>No new features in this version</Trans></h3>
        <p className="mt-1 text-sm text-muted-foreground">
          <Trans>This version has no notes to show here. The full changelog shows all changes.</Trans>
        </p>
      </div>
    );
  return (
    <>
      {summary.notices.length > 0 ? (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4" data-testid="release-notes-notices">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <TriangleAlert className="size-4" aria-hidden="true" />
            <Trans>Do this after the update</Trans>
          </h3>
          <ReleaseList items={summary.notices.map((item) => i18n._(item))} />
        </section>
      ) : null}
      {summary.groups.map((group) => (
        <ReleaseGroupSection key={group.type} type={group.type} items={group.items.map((item) => i18n._(item))} />
      ))}
    </>
  );
}

function ReleaseGroupSection({ type, items }: { type: ReleaseGroupType; items: string[] }) {
  const { t } = useLingui();
  const collapsible = type === "fixed" && items.length > OPEN_FIX_LIMIT;
  const [expanded, setExpanded] = useState(false);
  const label = type === "added" ? t`New` : type === "changed" ? t`Improved` : t`Fixed`;
  const count = items.length;
  return (
    <section data-release-group={type}>
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-full ${type === "added" ? "bg-primary" : type === "changed" ? "bg-sky-500" : "bg-muted-foreground"}`}
        />
        {label}
        <span className="rounded-full bg-primary/10 px-1.5 tabular-nums" aria-hidden="true">{count}</span>
      </h3>
      {!collapsible || expanded ? <ReleaseList items={items} /> : null}
      {collapsible ? (
        <Button variant="ghost" size="sm" className="-ms-2 mt-1 text-muted-foreground" aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}>
          {expanded ? <Trans>Hide fixes</Trans> : <Trans>Show {count} fixes</Trans>}
          <ChevronDown className={expanded ? "rotate-180 transition-transform" : "transition-transform"} aria-hidden="true" />
        </Button>
      ) : null}
    </section>
  );
}

function ReleaseList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-3 text-sm leading-relaxed">
      {items.map((item) => {
        const { headline, detail } = releaseEntry(item);
        return (
          <li key={item}>
            <span className="font-medium text-foreground">{headline}</span>
            {detail ? <span className="block text-muted-foreground">{detail}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

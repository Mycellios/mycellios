import { useLingui } from "@lingui/react/macro";
import { Skeleton } from "@mycellios/ui-web/components/ui/skeleton";

/** Widths vary so the placeholder reads as text, not as a grid of bars. */
const MICO_LINES = [["92%", "78%", "54%"], ["86%", "62%"], ["95%", "88%", "70%", "40%"]] as const;
const PERSON_WIDTHS = ["38%", "26%"] as const;

/**
 * The transcript while its first messages load: Mico replies on the left with their avatar,
 * the person's messages as bubbles on the right, in the same column as the real chat.
 */
export function TranscriptLoading({ className = "" }: { className?: string }) {
  const { t } = useLingui();
  return <div role="status" aria-label={t`Loading…`} aria-busy="true"
    className={`min-h-0 flex-1 overflow-hidden ${className}`}>
    <div aria-hidden="true" className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 py-6 sm:px-6">
      {MICO_LINES.map((lines, index) => <div key={index} className="flex flex-col gap-7">
        <div className="flex items-start gap-3">
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
            {lines.map((width, line) => <Skeleton key={line} className="h-3" style={{ width }} />)}
          </div>
        </div>
        {index < PERSON_WIDTHS.length ? <Skeleton className="ms-auto h-9 min-w-24 rounded-2xl" style={{ width: PERSON_WIDTHS[index] }} /> : null}
      </div>)}
    </div>
  </div>;
}

/** The chat composer's resting shape. */
function ComposerLoading() {
  return <div className="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-6 sm:pb-4">
    <div className="flex h-13 items-center gap-3 rounded-3xl border border-border bg-background px-3">
      <Skeleton className="size-7 shrink-0 rounded-full" />
      <Skeleton className="h-3 w-32" />
      <span className="flex-1" />
      <Skeleton className="size-7 shrink-0 rounded-full" />
      <Skeleton className="size-8 shrink-0 rounded-full" />
    </div>
  </div>;
}

/** One sidebar row: a Mico's avatar, its name and the last message. */
function RosterRowLoading({ name, preview }: { name: string; preview: string }) {
  return <div className="flex items-center gap-3 rounded-xl px-2.5 py-2">
    <Skeleton className="size-10 shrink-0 rounded-full" />
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2"><Skeleton className="h-3" style={{ width: name }} /><span className="flex-1" /><Skeleton className="h-2.5 w-8" /></div>
      <Skeleton className="h-2.5" style={{ width: preview }} />
    </div>
  </div>;
}

/**
 * The whole app while its first data loads, drawn in the shape it is about to take: on a
 * computer the page rail, the sidebar (Space, search, Micos, Credits) and the chat with its
 * header and composer; on a phone the chat with its compact header. Nothing in it is
 * interactive and it never stands for real content.
 */
export function ShellLoading() {
  const { t } = useLingui();
  return <div role="status" aria-label={t`Loading…`} aria-busy="true" className="flex h-full min-h-0 overflow-hidden bg-background">
    <div aria-hidden="true" className="contents [&_[data-slot=skeleton]]:bg-foreground/[0.06]">
      {/* Page rail (computers). */}
      <nav className="hidden w-[52px] shrink-0 flex-col items-center gap-3 border-e border-border bg-sidebar py-3 md:flex [&_[data-slot=skeleton]]:bg-foreground/[0.07]">
        <Skeleton className="size-7 rounded-full" />
        <span className="h-2" />
        {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="size-6 rounded-md" />)}
        <span className="flex-1" />
        {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="size-6 rounded-md" />)}
        <Skeleton className="size-6 rounded-md" />
      </nav>
      {/* Sidebar (computers). */}
      <aside className="hidden w-[300px] shrink-0 flex-col border-e border-border bg-sidebar md:flex lg:w-[316px] [&_[data-slot=skeleton]]:bg-foreground/[0.07]">
        <div className="flex h-12 items-center gap-2 px-4">
          <Skeleton className="h-3.5 w-24" />
          <span className="flex-1" />
          <Skeleton className="size-5 rounded-md" /><Skeleton className="size-5 rounded-md" /><Skeleton className="size-5 rounded-md" />
        </div>
        <div className="px-3"><Skeleton className="h-8 w-full rounded-full" /></div>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden px-1.5 pt-5">
          <Skeleton className="mx-2.5 mb-1 h-2.5 w-20" />
          <RosterRowLoading name="42%" preview="64%" />
          <RosterRowLoading name="50%" preview="58%" />
          <Skeleton className="mx-2.5 mt-4 mb-1 h-2.5 w-24" />
          <RosterRowLoading name="30%" preview="72%" />
          <RosterRowLoading name="46%" preview="66%" />
          <RosterRowLoading name="36%" preview="70%" />
          <RosterRowLoading name="52%" preview="60%" />
          <RosterRowLoading name="40%" preview="68%" />
        </div>
        <div className="mx-3 flex flex-col gap-3 border-t border-border py-3">
          <div className="flex items-center gap-2 px-2"><Skeleton className="size-4 rounded-full" /><Skeleton className="h-3 w-16" /><span className="flex-1" /><Skeleton className="h-3 w-14" /></div>
          <div className="flex items-center gap-2 px-2"><Skeleton className="size-4 rounded-full" /><div className="flex flex-col gap-1.5"><Skeleton className="h-3 w-24" /><Skeleton className="h-2.5 w-32" /></div><span className="flex-1" /><Skeleton className="size-9 rounded-full" /></div>
        </div>
      </aside>
      {/* Chat. */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-3 md:h-12 md:border-b-0 md:px-4">
          <Skeleton className="size-7 rounded-md md:hidden" />
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="hidden h-3 w-20 md:block" />
          <span className="flex-1" />
          <Skeleton className="hidden h-3 w-28 sm:block" />
          <Skeleton className="size-6 rounded-md" />
          <Skeleton className="hidden size-6 rounded-md md:block" />
        </header>
        <TranscriptLoading />
        <ComposerLoading />
      </main>
    </div>
  </div>;
}

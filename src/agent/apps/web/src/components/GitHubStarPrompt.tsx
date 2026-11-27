import { useLingui } from "@lingui/react/macro";
import { Button } from "@mycellios/ui-web";
import { Star, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  completeGitHubStarPrompt,
  dismissGitHubStarPrompt,
  gitHubStarPromptDue,
  MYCELLIOS_REPOSITORY_URL,
  recordGitHubStarVisit,
} from "../lib/github-star-prompt";

/** Waits until the person has settled in before asking. */
const SHOW_AFTER_MS = 30_000;

function storage(): Pick<Storage, "getItem" | "setItem"> {
  try {
    return window.localStorage;
  } catch {
    const memory = new Map<string, string>();
    return { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => void memory.set(key, value) };
  }
}

/** GitHub's mark (Octicons mark-github, MIT). */
function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="currentColor">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}

/**
 * Asks returning people for a GitHub star, once in a while and never on a first visit.
 * Everything is kept on this device; nothing is sent until the person opens GitHub.
 */
export function GitHubStarPrompt() {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const store = storage();
    const state = recordGitHubStarVisit(store, Date.now());
    if (!gitHubStarPromptDue(state, Date.now())) return;
    let timer: number | undefined;
    const arm = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => {
        if (gitHubStarPromptDue(recordGitHubStarVisit(store, Date.now()), Date.now())) setOpen(true);
      }, SHOW_AFTER_MS);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", arm);
    };
  }, []);

  if (!open) return null;
  const dismiss = () => {
    dismissGitHubStarPrompt(storage(), Date.now());
    setOpen(false);
  };
  const star = () => {
    completeGitHubStarPrompt(storage(), Date.now());
    setOpen(false);
    window.open(MYCELLIOS_REPOSITORY_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <aside
      aria-label={t`Star Mycellios on GitHub`}
      className="fixed end-4 top-14 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg"
    >
      <Button variant="ghost" size="icon-sm" className="absolute end-2 top-2 text-muted-foreground"
        aria-label={t`Close`} onClick={dismiss}>
        <X size={14} />
      </Button>
      <div className="flex items-start gap-3 pe-6">
        <GitHubMark className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t`Enjoying Mycellios so far?`}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t`A star on GitHub helps more people find Mycellios.`}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={dismiss}>{t`Not now`}</Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={star}>
          <Star size={14} className="fill-amber-400 text-amber-500" aria-hidden="true" />
          {t`Star on GitHub`}
        </Button>
      </div>
    </aside>
  );
}

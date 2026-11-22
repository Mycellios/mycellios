import { useLingui } from "@lingui/react/macro";
import { Button } from "@mycellios/ui-web";
import { Check, Link2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { developerContextLink, type DeveloperChatContext } from "../lib/developer-context-link";
import { useDeveloperMode } from "../lib/developer-mode";

export function DeveloperContextLink(context: DeveloperChatContext) {
  const { t } = useLingui();
  const [enabled] = useDeveloperMode();
  const [feedback, setFeedback] = useState<{ url: string; state: "copied" | "failed" }>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; clearTimeout(timer.current); };
  }, []);
  if (!enabled) return null;
  const url = developerContextLink(context, window.location.origin);
  const state = feedback?.url === url ? feedback.state : undefined;
  const label = state === "copied" ? t`Debug link copied`
    : state === "failed" ? t`Could not copy the link. Try again.` : t`Copy debug link`;
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      if (!alive.current) return;
      setFeedback({ url, state: "copied" });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setFeedback(undefined), 1600);
    } catch {
      if (alive.current) setFeedback({ url, state: "failed" });
    }
  }
  return <>
    <Button variant="ghost" size="sm" data-testid="developer-context-link"
      className="app-no-drag h-7 shrink-0 gap-1.5 px-1.5 text-xs font-normal text-muted-foreground max-md:h-11 max-md:min-w-11"
      aria-label={label} title={label} onClick={() => void copy()}>
      {state === "copied" ? <Check size={14} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />}
      <span className="hidden @lg:inline">{state === "copied" ? t`Copied` : state === "failed" ? t`Retry copy` : t`Copy link`}</span>
    </Button>
    <span className="sr-only" role="status">{state ? label : ""}</span>
  </>;
}

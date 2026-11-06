import { useEffect } from "react";

/** A visible installed-app shortcut is a capture request, never a message send. */
export function useVoiceShortcut({ requested, ready, blocked, scope, consume, start }: {
  requested: boolean; ready: boolean; blocked: boolean; scope: string;
  consume?: () => void; start: () => void;
}) {
  useEffect(() => {
    if (!requested || !ready) return;
    // Defer until effects settle so StrictMode cannot start two recordings.
    const timer = setTimeout(() => {
      consume?.();
      if (blocked || document.visibilityState !== "visible" ||
          !window.matchMedia("(display-mode: standalone)").matches) return;
      start();
    }, 0);
    return () => clearTimeout(timer);
  }, [requested, ready, blocked, scope, consume, start]);
}

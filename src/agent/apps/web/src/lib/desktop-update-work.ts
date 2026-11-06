import { getSnapshot as activeCall } from "./call-session";
import { composerHoldsUnsavedWork, flushComposerDrafts } from "./composer-draft";
import { dictation } from "./dictation";

/** Saved text survives a native restart. Calls, uploads and unsaved forms do not. */
export function canRestartDesktop(): boolean {
  if (activeCall() !== null || dictation.state.status !== "idle" ||
      !flushComposerDrafts() || composerHoldsUnsavedWork()) return false;
  return ![...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]')]
    .some(dialog => !dialog.querySelector('[data-testid="desktop-update-settings"]'));
}

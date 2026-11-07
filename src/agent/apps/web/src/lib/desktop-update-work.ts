import { endCall, getSnapshot as activeCall } from "./call-session";
import { composerHoldsUnsavedWork, flushComposerDrafts } from "./composer-draft";
import { closeContinuousVoice, hasContinuousVoice } from "./continuous-voice-owner";
import { dictation } from "./dictation";

export function desktopUpdateHasCall(): boolean {
  return activeCall() !== null || hasContinuousVoice();
}

export function endDesktopUpdateCall(): void {
  if (activeCall() !== null) endCall();
  closeContinuousVoice();
}

function canInterrupt(allowCall: boolean): boolean {
  const hasCall = desktopUpdateHasCall();
  if ((!allowCall && hasCall) ||
      (dictation.state.status !== "idle" && !(allowCall && hasCall)) ||
      !flushComposerDrafts() || composerHoldsUnsavedWork()) return false;
  return ![...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]')]
    .some(dialog => !dialog.matches("dialog[data-desktop-update-gate]") &&
      !(allowCall && hasCall && dialog.matches("[data-continuous-voice]")) &&
      !dialog.querySelector('[data-testid="desktop-update-settings"]'));
}

/** A call may continue behind the update screen until the owner chooses to end it. */
export function canShowDesktopUpdate(): boolean {
  return canInterrupt(true);
}

/** The native acknowledgement still requires all audio and unsaved work to be settled. */
export function canRestartDesktop(): boolean {
  return canInterrupt(false);
}

/** Intercept an interactive quit before Electron emits any shutdown hooks. */
export function createDesktopQuitGuard({
  busy,
  confirm,
  quit,
}: {
  busy: () => boolean;
  confirm: () => Promise<boolean>;
  quit: () => void;
}) {
  let confirming = false;
  return function deferQuitIfBusy() {
    if (confirming) return true;
    if (!busy()) return false;
    confirming = true;
    void confirm()
      .then((confirmed) => {
        if (confirmed) quit();
      })
      .catch(() => { /* If the prompt fails, keep the session alive. */ })
      .finally(() => { confirming = false; });
    return true;
  };
}

import { Trans, useLingui } from "@lingui/react/macro";
import { productBrand, type DesktopUpdateState } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { desktopBridge } from "../lib/desktop";
import { canRestartDesktop, canShowDesktopUpdate, desktopUpdateHasCall, endDesktopUpdateCall } from "../lib/desktop-update-work";
import { appPath } from "../lib/app-path";
import { playUpdateMycelium } from "../lib/update-mycelium";

const UPDATE_DISK_SPACE_MESSAGE = "Free at least 6 GB of disk space before restarting to update.";

function updateRequiresAttention(state: DesktopUpdateState | null) {
  return Boolean(state?.availableVersion && ["available", "downloading", "ready", "checking", "error"].includes(state.phase));
}

function useDesktopUpdates() {
  const { t } = useLingui();
  const bridge = desktopBridge()?.update;
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmedCheck, setConfirmedCheck] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [safeToInterrupt, setSafeToInterrupt] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const pending = useRef(false);
  const revision = useRef(0);
  const chatWindow = desktopBridge()?.chatWindow;
  useEffect(() => {
    const onPrepare = bridge?.onPrepare ?? chatWindow?.onPrepare;
    return onPrepare?.(canRestartDesktop);
  }, [bridge, chatWindow]);

  useEffect(() => {
    if (!bridge) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const started = revision.current;
      try {
        const next = await bridge!.state();
        if (!stopped && started === revision.current) {
          setSafeToInterrupt(updateRequiresAttention(next) && canShowDesktopUpdate());
          setCallActive(desktopUpdateHasCall());
          setState((current) =>
            current &&
            Object.entries(next).every(
              ([key, value]) => current[key as keyof DesktopUpdateState] === value,
            )
              ? current
              : next,
          );
        }
      } catch {
        // A disappearing bridge during shutdown should not interrupt the app.
      } finally {
        if (!stopped) timer = setTimeout(refresh, 2_000);
      }
    }
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [bridge]);

  async function act(action: "check" | "download" | "install" | "forceInstall" | "cancelInstall" | "restartWhenIdle" | "cancelRestart") {
    if (!bridge || pending.current) return;
    pending.current = true;
    revision.current++;
    setBusy(true);
    setError(null);
    if ((action === "install" || action === "forceInstall") && desktopUpdateHasCall()) endDesktopUpdateCall();
    if (action === "check") setConfirmedCheck(null);
    try {
      if (action === "download") void playUpdateMycelium(document.activeElement, "gather");
      if (action === "install" && canRestartDesktop()) await playUpdateMycelium(document.activeElement);
      const next = await bridge[action]?.();
      if (!next) return;
      setState(next);
      setSafeToInterrupt(updateRequiresAttention(next) && canShowDesktopUpdate());
      setCallActive(desktopUpdateHasCall());
      if (
        action === "check" &&
        next.phase === "idle" &&
        !next.message &&
        next.checkedAt !== state?.checkedAt
      ) {
        setConfirmedCheck(next.checkedAt);
      }
    } catch {
      setError(t`Could not complete the update. Try again.`);
    } finally {
      revision.current++;
      pending.current = false;
      setBusy(false);
    }
  }
  const message = error ?? (
    state?.handoffComplete
      ? t`Opened the system installer. Restart Mycellios when it finishes.`
      : state?.message === UPDATE_DISK_SPACE_MESSAGE
      ? t`Free at least 6 GB of disk space before restarting to update.`
      : state?.message === "Another update is still running. Keep using Mycellios and finish that installation before retrying."
        ? t`Another update is still running. Keep using Mycellios and finish that installation before retrying.`
      : state?.message === "Could not complete the update. Try again."
        ? t`Could not complete the update. Try again.`
      : state?.message ?? null
  );
  return { state, busy, message, act, confirmedCheck, safeToInterrupt, callActive, forceAvailable: state?.supportsForceRestart === true && typeof bridge?.forceInstall === "function" };
}

const UpdatesContext = createContext<ReturnType<typeof useDesktopUpdates> | null>(null);
export function useDesktopUpdateSettings() { return useContext(UpdatesContext); }

export function DesktopUpdatesProvider({ children }: { children: ReactNode }) {
  const updates = useDesktopUpdates();
  return (
    <UpdatesContext.Provider value={updates}>
      {children}
      {updates.state?.installPending && !updates.state.autoInstallEnabled && !updates.state.relaunchPending &&
        !document.querySelector('[data-testid="desktop-update-settings"]') && updates.safeToInterrupt && updateRequiresAttention(updates.state) && (
        <DesktopUpdateGate {...updates} state={updates.state} />
      )}
    </UpdatesContext.Provider>
  );
}

function PendingRestart({ state }: { state: DesktopUpdateState }) {
  if (state.waitingFor === "unsaved_work") return <Trans>Save changes or finish the call to restart.</Trans>;
  if (state.restartMode === "now") return <Trans>Saving work and restarting…</Trans>;
  return <Trans>Waiting for local tasks and unsaved work…</Trans>;
}

function DesktopUpdateGate({
  state, busy, message: updateMessage, act, forceAvailable, callActive,
}: ReturnType<typeof useDesktopUpdates> & { state: DesktopUpdateState }) {
  const { t } = useLingui();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const preventDismiss = (event: Event) => event.preventDefault();
    element.setAttribute("closedby", "none");
    element.addEventListener("cancel", preventDismiss);
    element.showModal();
    heading.current?.focus();
    return () => {
      element.removeEventListener("cancel", preventDismiss);
      element.close();
    };
  }, []);
  const ready = state.phase === "ready";
  const rawMessage = state.installPending ? null : updateMessage;
  const message = rawMessage === "Could not complete the update. Try again."
    ? t`Could not complete the update. Try again.` : rawMessage;
  const failed = state.phase === "error" || Boolean(message);
  const canForce = state.installPending && forceAvailable && state.waitingFor === "local_work" && state.restartMode !== "now";
  const canAct = canForce || (!state.installPending && (ready || failed || state.phase === "available"));
  function restart() {
    if (desktopUpdateHasCall()) endDesktopUpdateCall();
    void act(forceAvailable ? "forceInstall" : "install");
  }
  const percent = ready ? 100 :
    typeof state.percent === "number" && Number.isFinite(state.percent)
      ? Math.max(0, Math.min(100, Math.round(state.percent))) : undefined;
  return (
    <dialog
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="desktop-update-heading"
      aria-describedby="desktop-update-description"
      data-desktop-update-gate
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-auto border-0 bg-background p-0 text-foreground backdrop:bg-background"
    >
      <div className="grid min-h-full place-items-center px-6 py-12">
        <div className="flex w-full max-w-sm flex-col items-center text-center">
          <img src={appPath("/mycellios/app-icon-v2-192.png")} alt="" width={64} height={64} className="mb-8 size-16" />
          <h1 id="desktop-update-heading" ref={heading} tabIndex={-1} className="text-heading2 font-medium outline-none">
            {state.installPending ? (state.installAction === "system-installer" ? <Trans>Preparing the installer</Trans> : <Trans>Preparing to restart</Trans>)
              : failed ? <Trans>Could not complete the update</Trans>
              : ready ? <Trans>Update ready</Trans>
              : state.phase === "available" ? <Trans>Update available</Trans>
              : <Trans>Updating Mycellios</Trans>}
          </h1>
          <p id="desktop-update-description" role="status" className="mt-2 text-sm text-muted-foreground">
            {state.installPending ? <PendingRestart state={state} /> : message ??
              (ready && state.installAction === "system-installer" ? <Trans>Install the update with your system installer, then reopen Mycellios.</Trans>
                : ready && callActive ? <Trans>Your call will end when you restart.</Trans>
                : ready ? <Trans>Restart to finish installing the update.</Trans>
                : <Trans>Mycellios will save your work before restarting.</Trans>)}
          </p>
          {!failed && (
            <progress
              aria-label={t`Download progress`}
              max={100}
              value={percent}
              className="mt-6 h-2 w-full max-w-60 overflow-hidden rounded-full accent-primary [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary"
            />
          )}
          <p className="mt-3 text-xs tabular-nums text-muted-foreground">
            {!ready && !failed && percent !== undefined ? `${percent}%` : `Mycellios ${state.availableVersion}`}
          </p>
          {canAct && (
            <Button
              className="mt-6 rounded-full"
              disabled={busy}
              onClick={() => {
                if (canForce || ready) restart();
                else void act(failed ? "check" : "download");
              }}
            >
              {ready && state.installAction === "system-installer" ? <Trans>Open installer</Trans>
                : ready && callActive ? <Trans>End call and restart</Trans>
                : canForce ? <Trans>Restart now</Trans> : failed ? <Trans>Try again</Trans>
                : ready ? <Trans>Restart to update</Trans> : <Trans>Download update</Trans>}
            </Button>
          )}
          {callActive && !ready && (
            <Button variant="ghost" className="mt-4" onClick={endDesktopUpdateCall}>
              <Trans>End call</Trans>
            </Button>
          )}
          {state.installPending && (
            <Button variant="ghost" className="mt-4" disabled={busy} onClick={() => void act("cancelInstall")}>
              <Trans>Cancel update</Trans>
            </Button>
          )}
          <a
            href={new URL("/downloads/desktop", productBrand.apiBaseUrl).href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            <Trans>Download the latest version</Trans>
          </a>
        </div>
      </div>
    </dialog>
  );
}

/** Reuse the provider's bridge polling and guarded install action. */
export function useSidebarUpdate() {
  const updates = useContext(UpdatesContext);
  return {
    available: updates?.state?.phase === "ready",
    busy: (updates?.busy ?? false) || (updates?.state?.installPending === true && (!updates?.forceAvailable || updates.state.restartMode === "now")),
    state: updates?.state ?? null,
    callActive: updates?.callActive ?? false,
    error: updates?.message ?? null,
    install: () => {
      void updates?.act(updates.state?.installPending && updates.forceAvailable ? "forceInstall" : "install");
    },
    download: () => { void updates?.act("download"); },
    check: () => { void updates?.act("check"); },
    cancel: () => { void updates?.act("cancelInstall"); },
    cancelBusy: updates?.busy ?? false,
  };
}

export function DesktopSidebarUpdate() {
  const { t } = useLingui();
  const update = useSidebarUpdate();
  const state = update.state;
  if (!state || !updateRequiresAttention(state)) return null;
  const ready = state.phase === "ready";
  const percent =
    typeof state.percent === "number" && Number.isFinite(state.percent)
      ? Math.max(0, Math.min(100, Math.round(state.percent)))
      : null;
  return (
    <div className="mx-2.5 mt-2 min-w-0 rounded-xl border border-border bg-sidebar-accent p-3">
      <p role="status" className="text-xs font-medium">
        {state.installPending ? <PendingRestart state={state} /> : update.error ??
          (ready ? (state.installAction === "system-installer" ? <Trans>Update ready to install</Trans> : <Trans>Restart to update</Trans>) : state.phase === "available" ? <Trans>Update available</Trans> : <Trans>Downloading…</Trans>)}
      </p>
      {ready ? (
        <Button
          aria-label={t`Install update`}
          className="mt-2 w-full"
          disabled={update.busy}
          onClick={update.install}
        >
          {state.installAction === "system-installer" ? <Trans>Open installer</Trans>
            : update.callActive ? <Trans>End call and restart</Trans> : state.installPending && state.supportsForceRestart ? <Trans>Restart now</Trans> : <Trans>Restart to update</Trans>}
        </Button>
      ) : state.phase === "error" ? <Button variant="outline" className="mt-2 w-full" disabled={update.busy} onClick={update.check}><Trans>Try again</Trans></Button>
        : state.phase === "available" ? <Button variant="outline" className="mt-2 w-full" disabled={update.busy} onClick={update.download}><Trans>Download update</Trans></Button> : percent !== null ? (
        <div className="mt-2 flex items-center gap-2">
          <progress
            aria-label={t`Download progress`}
            max={100}
            value={percent}
            className="h-1.5 min-w-0 flex-1 accent-primary"
          />
          <span className="text-xs tabular-nums">{percent}%</span>
        </div>
      ) : null}
      {update.error && <a href={new URL("/downloads/desktop", productBrand.apiBaseUrl).href} target="_blank" rel="noopener noreferrer"
        className="mt-2 block text-xs underline underline-offset-4"><Trans>Download the latest version</Trans></a>}
      {state.installPending && <Button size="sm" variant="ghost" className="mt-2 w-full" disabled={update.cancelBusy} onClick={update.cancel}>
        <Trans>Cancel update</Trans>
      </Button>}
    </div>
  );
}

export function DesktopUpdateSection() {
  const updates = useContext(UpdatesContext);
  if (!updates?.state) return null;
  const { state, busy, message, act, confirmedCheck, forceAvailable } = updates;
  const ready = state.phase === "ready";
  const downloading = state.phase === "available" || state.phase === "downloading";
  return (
    <section
      data-testid="desktop-update-settings"
      className="mt-5 rounded-xl border border-border px-4 py-4"
    >
      <h3 className="text-heading3 font-medium text-foreground">
        <Trans>Desktop app</Trans>
      </h3>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">v{state.currentVersion}</span>
        <Button
          variant="outline"
          disabled={busy || (state.installPending && (!forceAvailable || state.restartMode === "now")) || downloading || state.phase === "checking"}
          onClick={() => void act(state.installPending && forceAvailable ? "forceInstall" : ready ? "install" : "check")}
        >
          {state.installAction === "system-installer" && ready && updates.callActive ? <Trans>End call to update</Trans>
            : state.installAction === "system-installer" && ready ? <Trans>Open installer</Trans>
            : ready && updates.callActive ? <Trans>End call and restart</Trans> : state.installPending && forceAvailable ? <Trans>Restart now</Trans> : ready ? (
            <Trans>Restart to update</Trans>
          ) : downloading ? (
            <Trans>Downloading…</Trans>
          ) : busy || state.phase === "checking" ? (
            <Trans>Checking…</Trans>
          ) : (
            <Trans>Check for updates</Trans>
          )}
        </Button>
      </div>
      {state.installPending ? (
        <div className="mt-2 flex items-center justify-between gap-3">
          <span role="status" className="text-sm text-muted-foreground"><PendingRestart state={state} /></span>
          <Button variant="ghost" disabled={busy} onClick={() => void act("cancelInstall")}><Trans>Cancel update</Trans></Button>
        </div>
      ) : null}
      <p role="status" className="mt-2 text-sm text-muted-foreground">
        {state.installPending ? null : message ??
          (downloading ? (
            `${state.percent ?? 0}%`
          ) : state.phase === "idle" && confirmedCheck && state.checkedAt === confirmedCheck ? (
            <Trans>Up to date</Trans>
          ) : null)}
      </p>
    </section>
  );
}

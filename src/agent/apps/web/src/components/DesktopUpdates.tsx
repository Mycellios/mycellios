import { Trans, useLingui } from "@lingui/react/macro";
import { productBrand, type DesktopUpdateState } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { UpdateNotice } from "./UpdateNotice";
import { desktopBridge } from "../lib/desktop";
import { canRestartDesktop, canShowDesktopUpdate, desktopUpdateHasCall, endDesktopUpdateCall } from "../lib/desktop-update-work";
import { playUpdateMycelium } from "../lib/update-mycelium";

const UPDATE_DISK_SPACE_MESSAGE = "Free at least 6 GB of disk space before restarting to update.";

function updateRequiresAttention(state: DesktopUpdateState | null) {
  return Boolean(state?.availableVersion && ["available", "downloading", "ready", "checking", "error"].includes(state.phase));
}

/** Both native restart controllers feed the same pending-update presentation. */
function observedUpdateState(state: DesktopUpdateState): DesktopUpdateState {
  if (state.phase !== "ready" || state.installPending || !state.relaunchPending) return state;
  return { ...state, installPending: true, restartMode: "whenIdle",
    waitingFor: state.relaunchWaitingFor === "unsaved_work" ? "unsaved_work" : "local_work" };
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
        const next = observedUpdateState(await bridge!.state());
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
      if (action === "install" && canRestartDesktop()) await playUpdateMycelium(document.activeElement);
      const method = action === "cancelInstall" && state?.relaunchPending ? "cancelRestart" : action;
      const result = await bridge[method]?.();
      if (!result) throw new Error("Update action is unavailable");
      const next = observedUpdateState(result);
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
    state?.relaunchError ? t`Could not complete the update. Try again.` : state?.handoffComplete
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
  return <UpdatesContext.Provider value={updates}>{children}</UpdatesContext.Provider>;
}

function PendingRestart({ state }: { state: DesktopUpdateState }) {
  if (state.waitingFor === "unsaved_work") return <Trans>Save changes or finish the call to restart.</Trans>;
  if (state.restartMode === "now") return <Trans>Saving work and restarting…</Trans>;
  return <Trans>Waiting for local tasks and unsaved work…</Trans>;
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
  const actionRef = useRef<HTMLButtonElement>(null);
  const animatedVersion = useRef<string | null>(null);
  useEffect(() => {
    if (state?.phase !== "downloading" || !state.availableVersion || animatedVersion.current === state.availableVersion) return;
    animatedVersion.current = state.availableVersion;
    void playUpdateMycelium(actionRef.current, "gather");
  }, [state?.phase, state?.availableVersion]);
  useEffect(() => {
    if (!state?.automaticRestartAt) return;
    const timer = setTimeout(() => {
      if (canRestartDesktop()) void playUpdateMycelium(actionRef.current);
    }, Math.max(0, state.automaticRestartAt - Date.now() - 1_400));
    return () => clearTimeout(timer);
  }, [state?.automaticRestartAt]);
  if (!state || !updateRequiresAttention(state)) return null;
  const ready = state.phase === "ready";
  const downloading = state.phase === "downloading" || state.phase === "checking";
  const failed = state.phase === "error" || Boolean(update.error);
  const percent = typeof state.percent === "number" && Number.isFinite(state.percent)
    ? Math.max(0, Math.min(100, Math.round(state.percent))) : null;
  const waiting = Boolean(state.installPending || state.automaticRestartAt);
  const handedOff = state.handoffComplete === true;
  const label = failed && !handedOff ? update.error ?? t`Update needs attention`
    : handedOff ? update.error ?? t`Update ready to install`
    : state.automaticRestartAt ? t`Updating shortly`
    : waiting ? state.waitingFor === "unsaved_work" ? t`Save changes or finish the call to restart.` : t`Update waiting`
    : ready ? t`Update ready to install` : t`New update available`;
  // One action per phase. Postponing keeps the downloaded update and uses the native cancellation guard.
  const actionLabel = waiting ? t`Later` : failed && !handedOff ? t`Try again` : ready ? t`Install update` : t`Download update`;
  const action = waiting ? t`Later` : failed && !handedOff ? t`Try again`
    : downloading ? (percent === null ? state.phase === "checking" ? t`Checking…` : t`Downloading…` : `${percent}%`)
    : ready ? state.installAction === "system-installer" ? t`Open installer`
      : update.callActive ? t`End call and restart` : t`Restart`
    : t`Download`;
  return <UpdateNotice actionRef={actionRef} label={label} actionLabel={actionLabel}
    ready={ready} failed={failed && !handedOff} deferred={waiting}
    busy={waiting ? update.cancelBusy : update.busy || downloading}
    disabled={waiting ? update.cancelBusy : update.busy || downloading || handedOff}
    progress={downloading ? percent : undefined} progressLabel={t`Download progress`}
    action={action} onAction={waiting ? update.cancel : ready ? update.install : failed ? update.check : update.download}
  />;

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
      {message && !state.installPending && !state.handoffComplete && <a
        href={new URL("/downloads/desktop", productBrand.apiBaseUrl).href}
        target="_blank" rel="noopener noreferrer"
        className="mt-2 inline-block text-xs text-muted-foreground underline underline-offset-4"
      ><Trans>Download the latest version</Trans></a>}
    </section>
  );
}

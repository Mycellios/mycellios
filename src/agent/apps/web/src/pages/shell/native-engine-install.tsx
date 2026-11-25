import { i18n } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";
import type { NativeEngineInstallable, NativeEngineInstallProgress, NativeEngineUpdate, NativeInstallEngine } from "@mycellios/contracts";
import { Button, Spinner } from "@mycellios/ui-web";
import { useEffect, useState } from "react";
import { useSpaceRpc } from "../../lib/space-rpc";
import { errorText } from "../../lib/user-error";

const NAMES: Record<NativeInstallEngine, string> = { codex: "Codex", claude: "Claude Code", opencode: "OpenCode" };
/** How often a running install is read again from the PC. */
const POLL_MS = 2_000;

function megabytes(bytes: number) {
  return new Intl.NumberFormat(i18n.locale || "en", { style: "unit", unit: "megabyte", maximumFractionDigits: 0 })
    .format(Math.max(1, Math.round(bytes / 1_000_000)));
}

const runningState = (progress?: NativeEngineInstallProgress) => progress?.state === "downloading" || progress?.state === "checking";

/** Reads the PC's engines again while an install or update runs there. */
function usePollWhileRunning(running: boolean, onChanged: () => void) {
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(onChanged, POLL_MS);
    return () => clearInterval(timer);
  }, [running, onChanged]);
}

/** The PC's report on a running install or update: download progress, then its check. */
function InstallProgress({ engine, progress, bytes }: { engine: NativeInstallEngine; progress: NativeEngineInstallProgress; bytes?: number }) {
  const { t } = useLingui();
  const name = NAMES[engine];
  const received = megabytes(progress.receivedBytes ?? 0);
  const total = megabytes(progress.totalBytes ?? bytes ?? 0);
  return (
    <div className="border-t border-border px-4 py-3 text-sm" data-testid="native-engine-install">
      <p role="status" className="flex items-center gap-2 text-muted-foreground">
        <Spinner className="text-muted-foreground" />
        {progress.state === "checking" ? t`Checking ${name}…` : t`Downloading ${name}: ${received} of ${total}`}
      </p>
    </div>
  );
}

/** Asks the PC for an install or update; the outcome comes back with its engines. */
function useInstallRequest(botId: string, onChanged: () => void) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function request(input: { engine: NativeInstallEngine; version?: string }) {
    setBusy(true);
    setError(null);
    try {
      await rpc.engines.install({ botId, ...input });
      setConfirming(false);
      onChanged();
    } catch (cause) {
      setError(errorText(cause, t`Could not reach the PC. Try again.`));
    } finally {
      setBusy(false);
    }
  }
  return { confirming, setConfirming, busy, error, setError, request };
}

/**
 * Installs a missing CLI on the PC that runs the Mico, for its owner (specs/native-engines/spec.md
 * phase 3). The PC downloads the version its lock file pins from the vendor's npm package and checks
 * it against the published hash before it runs; this only asks for it and shows the progress.
 */
export function NativeEngineInstall({ botId, release, progress, onChanged }: {
  botId: string;
  release: NativeEngineInstallable;
  /** The PC's report on a running install, or why the last one failed. */
  progress?: NativeEngineInstallProgress;
  /** Reads the PC's engines again; installed engines and progress come only from the PC. */
  onChanged: () => void;
}) {
  const { t } = useLingui();
  const { confirming, setConfirming, busy, error, setError, request } = useInstallRequest(botId, onChanged);
  const running = runningState(progress);
  usePollWhileRunning(running, onChanged);
  if (running) return <InstallProgress engine={release.engine} progress={progress!} bytes={release.bytes} />;
  const name = NAMES[release.engine];
  const version = release.version;
  const size = megabytes(release.bytes);
  const packageName = release.package;
  const failure = error ?? (progress?.state === "failed" ? progress.error : undefined);
  return (
    <div className="flex flex-col gap-2 border-t border-border px-4 py-3 text-sm" data-testid="native-engine-install">
      {confirming ? <>
        <p>{t`Install ${name} ${version} on this PC? It downloads ${size} from npm (${packageName}) and checks it before it runs.`}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>{t`Cancel`}</Button>
          <Button type="button" size="sm" disabled={busy} onClick={() => void request({ engine: release.engine })}>{busy ? <Spinner /> : null}{t`Install`}</Button>
        </div>
      </> : (
        <Button type="button" size="sm" className="self-start" onClick={() => { setError(null); setConfirming(true); }}>
          {t`Install ${name}`}
        </Button>
      )}
      {failure ? <p role="alert" className="text-xs text-destructive">{failure}</p> : null}
    </div>
  );
}

/**
 * Updates a CLI the PC runs from its store to the newer version that PC offers, once the owner
 * confirms it. The PC verifies it like a first install; turns already running keep the copy they
 * started with, and new ones wait while it is checked. Also shows an update the PC started itself
 * (replacing a withdrawn version) and why the last one failed.
 */
export function NativeEngineUpdateOffer({ botId, engine, release, progress, onChanged }: {
  botId: string;
  engine: NativeInstallEngine;
  /** The newer version the PC offers, if any. */
  release?: NativeEngineUpdate;
  progress?: NativeEngineInstallProgress;
  onChanged: () => void;
}) {
  const { t } = useLingui();
  const { confirming, setConfirming, busy, error, setError, request } = useInstallRequest(botId, onChanged);
  const running = runningState(progress);
  usePollWhileRunning(running, onChanged);
  if (running) return <InstallProgress engine={engine} progress={progress!} bytes={release?.bytes} />;
  const failure = error ?? (progress?.state === "failed" ? progress.error : undefined);
  if (!release && !failure) return null;
  const name = NAMES[engine];
  const version = release?.version ?? "";
  const current = release?.current ?? "";
  const size = megabytes(release?.bytes ?? 0);
  const packageName = release?.package ?? "";
  return (
    <div className="flex flex-col gap-2 border-t border-border px-4 py-3 text-sm" data-testid="native-engine-update">
      {release ? confirming ? <>
        <p>{t`Update ${name} to ${version} on this PC? It downloads ${size} from npm (${packageName}) and checks it before it runs. New ${name} turns wait while it is checked.`}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>{t`Cancel`}</Button>
          <Button type="button" size="sm" disabled={busy} onClick={() => void request({ engine, version: release.version })}>{busy ? <Spinner /> : null}{t`Update`}</Button>
        </div>
      </> : <>
        <p className="text-muted-foreground">{t`${name} ${version} is available. This PC runs ${current}.`}</p>
        <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => { setError(null); setConfirming(true); }}>
          {t`Update ${name}`}
        </Button>
      </> : null}
      {failure ? <p role="alert" className="text-xs text-destructive">{failure}</p> : null}
      {failure && release ? <p className="text-xs text-muted-foreground">{t`This PC keeps ${name} ${current}.`}</p> : null}
    </div>
  );
}

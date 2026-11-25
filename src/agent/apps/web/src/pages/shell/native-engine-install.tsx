import { i18n } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";
import type { NativeEngineInstallable, NativeEngineInstallProgress, NativeInstallEngine } from "@mycellios/contracts";
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
  const rpc = useSpaceRpc();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = progress?.state === "downloading" || progress?.state === "checking";

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(onChanged, POLL_MS);
    return () => clearInterval(timer);
  }, [running, onChanged]);

  async function install() {
    setBusy(true);
    setError(null);
    try {
      await rpc.engines.install({ botId, engine: release.engine });
      setConfirming(false);
      onChanged();
    } catch (cause) {
      setError(errorText(cause, t`Could not reach the PC. Try again.`));
    } finally {
      setBusy(false);
    }
  }

  const name = NAMES[release.engine];
  if (running) {
    const received = megabytes(progress.receivedBytes ?? 0);
    const total = megabytes(progress.totalBytes ?? release.bytes);
    return (
      <div className="border-t border-border px-4 py-3 text-sm" data-testid="native-engine-install">
        <p role="status" className="flex items-center gap-2 text-muted-foreground">
          <Spinner className="text-muted-foreground" />
          {progress.state === "checking" ? t`Checking ${name}…` : t`Downloading ${name}: ${received} of ${total}`}
        </p>
      </div>
    );
  }
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
          <Button type="button" size="sm" disabled={busy} onClick={() => void install()}>{busy ? <Spinner /> : null}{t`Install`}</Button>
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

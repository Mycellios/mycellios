import { useLingui } from "@lingui/react/macro";
import type { NativeAccountEngine, NativeEngineAccountResult } from "@mycellios/contracts";
import { Button, Spinner } from "@mycellios/ui-web";
import { useEffect, useState } from "react";
import { desktopBridge } from "../../lib/desktop";
import { useSpaceRpc } from "../../lib/space-rpc";
import { errorText } from "../../lib/user-error";

const NAMES: Record<NativeAccountEngine, string> = { codex: "ChatGPT", claude: "Claude Code" };
/** How often, and for how long, a started sign-in is checked on the PC (its CLI's own window is 10 min). */
const POLL_MS = 3_000;
const WAIT_MS = 10 * 60_000;

type Waiting = Exclude<NativeEngineAccountResult, { status: "signedOut" }>;

/**
 * Signs the PC's Codex or Claude Code in or out for the Mico's owner
 * (specs/native-engines/spec.md phase 1). Desktop opens the CLI's own sign-in on that PC;
 * elsewhere Codex gives a one-time code, and Claude Code asks to open Mycellios on the PC.
 */
export function NativeEngineAccount({ botId, engine, signedOut, onChanged }: {
  botId: string;
  engine: NativeAccountEngine;
  signedOut: boolean;
  /** Reads the PC's engines again; the sign-in state comes only from the CLI. */
  onChanged: () => void;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const name = NAMES[engine];
  const onDesktop = Boolean(desktopBridge());
  const [waiting, setWaiting] = useState<{ result: Waiting; until: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!signedOut) setWaiting(null);
  }, [signedOut]);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      if (Date.now() > waiting.until) setWaiting(null);
      else onChanged();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, onChanged]);

  async function run(action: "signIn" | "signOut") {
    setBusy(true);
    setError(null);
    try {
      const result = action === "signIn"
        ? await rpc.engines.account({ botId, action, engine, flow: onDesktop || engine === "claude" ? "browser" : "device" })
        : await rpc.engines.account({ botId, action, engine });
      if (result.status === "signedOut") {
        setConfirming(false);
        onChanged();
      } else setWaiting({ result, until: Date.now() + WAIT_MS });
    } catch (cause) {
      setError(errorText(cause, t`Could not reach the PC. Try again.`));
    } finally {
      setBusy(false);
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (!signedOut && !confirming) {
    return (
      <div className="flex justify-end border-t border-border px-4 py-2">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(true)}>{t`Sign out`}</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 border-t border-border px-4 py-3 text-sm" data-testid="native-engine-account">
      {confirming ? <>
        <p>{t`Sign out of ${name} on this PC? It also signs you out in your own terminal and in every Mico on this PC.`}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>{t`Cancel`}</Button>
          <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void run("signOut")}>{t`Sign out`}</Button>
        </div>
      </> : waiting?.result.status === "device" ? <>
        <p>{t`Enter this code on the sign-in page:`}</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md bg-muted px-2 py-1 font-mono text-base tracking-wider">{waiting.result.userCode}</code>
          <Button type="button" variant="ghost" size="sm" onClick={() => void copy((waiting.result as { userCode: string }).userCode)}>
            {copied ? t`Copied` : t`Copy code`}
          </Button>
        </div>
        <a className="text-primary underline-offset-4 hover:underline" href={waiting.result.verificationUrl} target="_blank" rel="noopener noreferrer">{t`Open sign-in page`}</a>
      </> : waiting ? (
        <p role="status" className="flex items-center gap-2 text-muted-foreground">
          <Spinner className="text-muted-foreground" />
          {waiting.result.status === "terminal" ? t`Finish signing in in the window that opened on the PC.` : t`Finish signing in in your browser.`}
        </p>
      ) : engine === "claude" && !onDesktop ? (
        <p className="text-muted-foreground">{t`Open Mycellios on that PC to sign in to Claude Code.`}</p>
      ) : (
        <Button type="button" size="sm" className="self-start" disabled={busy} onClick={() => void run("signIn")}>
          {busy ? <Spinner /> : null}{t`Sign in to ${name}`}
        </Button>
      )}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

import { useLingui } from "@lingui/react/macro";
import { Button } from "@mycellios/ui-web";
import { useEffect, useState } from "react";
import { CopyButton } from "../../components/CopyButton";
import { appPath } from "../../lib/app-path";
import type { RpcClient } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

export function WorkflowWebhook({ client, id, version, dirty }: {
  client: RpcClient; id: string; version: number; dirty: boolean;
}) {
  const { t } = useLingui();
  const [status, setStatus] = useState<{ version: number | null; path: string }>();
  const [secret, setSecret] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<"rotate" | "revoke">();
  useEffect(() => {
    let live = true;
    void client.workflows.webhook({ id }).then(
      value => { if (live) setStatus(value); },
      cause => { if (live) setError(errorText(cause, t`Could not load the workflow webhook.`)); },
    );
    return () => { live = false; };
  }, [client, id, t]);

  async function change(action: "rotate" | "revoke") {
    if (busy || (action === "rotate" && dirty)) return;
    setConfirm(undefined);
    setBusy(true);
    setError("");
    setSecret(undefined);
    try {
      if (action === "rotate") {
        const value = await client.workflows.rotateWebhook({ id, expectedVersion: version });
        setStatus({ path: value.path, version: value.version });
        setSecret(value.secret);
      } else {
        await client.workflows.revokeWebhook({ id });
        setStatus(current => current && { ...current, version: null });
      }
    } catch (cause) {
      setError(errorText(cause, t`Could not update the workflow webhook.`));
    } finally {
      setBusy(false);
    }
  }

  const url = status && new URL(appPath(status.path), window.location.origin).href;
  return (
    <section aria-label={t`Workflow webhook`} className="grid gap-2 border-b border-border px-4 py-3 text-xs">
      {status ? (
        <>
          <p>{status.version === version ? t`Active for version ${version}` : status.version === null ? t`Webhook is off` : t`Enable the webhook again for this version.`}</p>
          {status.version === version && url ? <div className="flex flex-wrap items-center gap-2"><code className="break-all">{url}</code><CopyButton value={url} label={t`Copy webhook URL`} /></div> : null}
          {dirty ? <p className="text-muted-foreground">{t`Save your edits before enabling the webhook.`}</p> : null}
          <div className="flex flex-wrap gap-2">
            {!confirm ? (
              <>
                <Button size="xs" disabled={busy || dirty} onClick={() => status.version === null ? void change("rotate") : setConfirm("rotate")}>
                  {status.version === null ? t`Enable webhook` : t`Rotate secret`}
                </Button>
                {status.version !== null ? <Button size="xs" variant="ghost" disabled={busy} onClick={() => setConfirm("revoke")}>{t`Revoke`}</Button> : null}
              </>
            ) : (
              <>
                <p>{confirm === "rotate" ? t`The current secret will stop working.` : t`Incoming events will stop starting this workflow.`}</p>
                <Button size="xs" variant="ghost" onClick={() => setConfirm(undefined)}>{t`Cancel`}</Button>
                <Button size="xs" onClick={() => void change(confirm)}>{t`Confirm`}</Button>
              </>
            )}
          </div>
        </>
      ) : !error ? <p role="status">{t`Loading webhook…`}</p> : null}
      {secret ? <div className="flex flex-wrap items-center gap-2"><p>{t`Copy this signing secret now. It is shown only once.`}</p><code className="select-all break-all">{secret}</code><CopyButton value={secret} label={t`Copy secret`} /><Button size="xs" variant="ghost" onClick={() => setSecret(undefined)}>{t`Done`}</Button></div> : null}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </section>
  );
}

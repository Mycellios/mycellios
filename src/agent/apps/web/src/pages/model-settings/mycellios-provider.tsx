import { Trans, useLingui } from "@lingui/react/macro";
import type { ModelCredential } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchAuthCapabilities } from "../../lib/auth-capabilities";
import { useSpaceRpc } from "../../lib/space-rpc";

/** First-party connection: the signed-in account owns the funding and server-side key. */
export function MycelliosProvider({
  credential,
  onConnected,
}: {
  credential?: ModelCredential;
  onConnected: () => void | Promise<void>;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const capabilities = useQuery({
    queryKey: ["auth-capabilities"],
    queryFn: fetchAuthCapabilities,
  });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const connected = Boolean(
    credential?.hasKey &&
      credential.headerNames?.some((name) => name.toLowerCase() === "x-mycellios-funding"),
  );
  return (
    <li className="px-3 py-3" data-testid="mycellios-provider">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[15px] font-medium">Mycellios</span>
        {connected ? (
          <span className="text-[13px] text-success">
            <Trans>Connected with your account</Trans>
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-[13.5px] text-muted-foreground">
        <Trans>
          Use your credits on the Mycellios network. Choose a model in your Mico chat. No API key needed.
        </Trans>
      </p>
      {!connected ? (
        <Button
          type="button"
          variant="secondary"
          className="mt-3"
          disabled={busy || capabilities.data?.mycelliosAccount !== true}
          onClick={async () => {
            setBusy(true);
            setFailed(false);
            try {
              await rpc.models.connectMycellios();
              await onConnected();
            } catch {
              setFailed(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <Trans>Connecting…</Trans>
          ) : failed ? (
            <Trans>Retry connection</Trans>
          ) : (
            <Trans>Use my Mycellios credits</Trans>
          )}
        </Button>
      ) : null}
      {!connected &&
      !capabilities.isPending &&
      !capabilities.isError &&
      capabilities.data?.mycelliosAccount !== true ? (
        <p className="mt-2 text-sm text-muted-foreground">
          <Trans>Sign in with Mycellios to use your credits.</Trans>
        </p>
      ) : null}
      {failed || capabilities.isError ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t`Could not connect Mycellios. Try again. No credits were spent.`}
        </p>
      ) : null}
      {capabilities.isError ? (
        <Button
          type="button"
          variant="ghost"
          className="mt-2"
          onClick={() => void capabilities.refetch()}
        >
          <Trans>Retry connection</Trans>
        </Button>
      ) : null}
    </li>
  );
}

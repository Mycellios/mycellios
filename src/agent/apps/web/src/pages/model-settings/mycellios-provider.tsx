import { Trans, useLingui } from "@lingui/react/macro";
import type { ModelCredential } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { appPath } from "../../lib/app-path";
import { fetchAuthCapabilities } from "../../lib/auth-capabilities";
import { useSpaceRpc } from "../../lib/space-rpc";

export function isMycelliosProviderConnected(credential?: ModelCredential) {
  return Boolean(credential?.hasKey &&
    credential.headerNames?.some((name) => name.toLowerCase() === "x-mycellios-funding"));
}

/** First-party connection: the signed-in account owns the funding and server-side key. */
export function MycelliosProvider({
  credential,
  onConnected,
  directory = false,
}: {
  credential?: ModelCredential;
  onConnected: () => void | Promise<void>;
  directory?: boolean;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const capabilities = useQuery({
    queryKey: ["auth-capabilities"],
    queryFn: fetchAuthCapabilities,
  });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const connected = isMycelliosProviderConnected(credential);
  return (
    <li data-testid="mycellios-provider">
      {directory ? (
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
          className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-start hover:bg-accent/50 focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-ring">
          <img src={appPath("/mycellios/app-icon-v2-192.png")} alt="" className="size-4 shrink-0 rounded-sm" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Mycellios</span>
            <span className="block text-xs text-muted-foreground">{connected ? t`Connected with your account` : t`Not connected`}</span>
          </span>
          <ChevronRight aria-hidden className={`size-4 shrink-0 text-muted-foreground ${expanded ? "rotate-90" : "rtl:rotate-180"}`} />
        </button>
      ) : null}
      <div hidden={directory && !expanded} className={directory ? "px-3 pb-3 ps-10" : "px-3 py-3"}>
        {!directory ? <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[15px] font-medium">Mycellios</span>
          {connected ? (
            <span className="text-[13px] text-success">
              <Trans>Connected with your account</Trans>
            </span>
          ) : null}
        </div> : null}
        <p className="mt-1 text-[13.5px] text-muted-foreground">
          <Trans>
            Use models with your Mycellios credits. No API key needed.
          </Trans>
        </p>
        <p className="mt-2 text-[13px] text-muted-foreground"><Trans>Optional. Keep your own providers and choose which one to use for each Mico.</Trans></p>
        <p className="mt-1 text-xs text-muted-foreground"><Trans>External models include the 4% Mycellios service fee in the displayed price.</Trans></p>
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
              <Trans>Connect Mycellios</Trans>
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
      </div>
    </li>
  );
}

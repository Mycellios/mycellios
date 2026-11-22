import { useLingui } from "@lingui/react/macro";
import type { ArtifactShare } from "@mycellios/contracts";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from "@mycellios/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Link2 } from "lucide-react";
import { useState } from "react";
import { appPath } from "../lib/app-path";
import { useSpaceQueries } from "../lib/query";
import { useSpaceRpc } from "../lib/space-rpc";

export function shareLinkUrl(token: string, origin = window.location.origin): string {
  return new URL(appPath(`/api/shared/${token}`), origin).toString();
}

/**
 * The owner shares the version on screen. Only this control creates or revokes a link: Micos
 * have no tool for it, and a newer version stays private until the owner shares it here.
 */
export function ArtifactShareButton({ familyId, versionId, version }: { familyId: string; versionId: string; version: number }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const rpc = useSpaceRpc();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const shareOptions = queries.artifacts.getShare.queryOptions({ input: { artifactId: familyId } });
  const share = useQuery({ ...shareOptions, enabled: open });
  const current = share.data ?? null;

  async function run(action: () => Promise<ArtifactShare | null>) {
    setBusy(true);
    setError(null);
    try {
      queryClient.setQueryData(shareOptions.queryKey, await action());
    } catch {
      setError(t`Could not update the link. Try again.`);
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      if (!navigator.clipboard?.writeText) throw Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError(t`Could not copy the link. Select it and copy it.`);
    }
  }

  const url = current ? shareLinkUrl(current.token) : null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Link2 className="me-1.5" size={15} strokeWidth={1.9} />
        {t`Share`}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle>{t`Share link`}</DialogTitle>
          <DialogDescription>{t`Anyone with the link can open the version you share, without signing in.`}</DialogDescription>
          {share.isLoading ? null : url && current ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input readOnly value={url} aria-label={t`Share link`} onFocus={(event) => event.currentTarget.select()} />
                <Button variant="outline" onClick={() => void copy(url)}>
                  {copied ? <Check size={15} aria-hidden="true" /> : null}
                  {copied ? t`Copied` : t`Copy`}
                </Button>
              </div>
              {current.artifactId !== versionId ? (
                <p className="text-[13px] text-muted-foreground">
                  {t`The link shows version ${current.version}.`}{" "}
                  <Button variant="link" className="h-auto p-0 text-[13px]" disabled={busy}
                    onClick={() => void run(() => rpc.artifacts.share({ artifactId: versionId }))}>
                    {t`Share version ${version} instead`}
                  </Button>
                </p>
              ) : null}
              <Button variant="outline" className="text-destructive" disabled={busy}
                onClick={() => void run(async () => (await rpc.artifacts.unshare({ artifactId: familyId }), null))}>
                {t`Stop sharing`}
              </Button>
            </div>
          ) : (
            <Button disabled={busy || share.isError} onClick={() => void run(() => rpc.artifacts.share({ artifactId: versionId }))}>
              {t`Create link`}
            </Button>
          )}
          {error || share.isError ? (
            <p role="alert" className="text-[13px] text-destructive">{error ?? t`Could not load the link. Try again.`}</p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

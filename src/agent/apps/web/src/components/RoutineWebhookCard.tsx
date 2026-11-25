import { useLingui } from "@lingui/react/macro";
import { routineEventsPath } from "@mycellios/contracts";
import { Button } from "@mycellios/ui-web";
import { useState } from "react";
import { appPath } from "../lib/app-path";
import { useSpaceRpc } from "../lib/space-rpc";
import { CopyButton } from "./CopyButton";

export function RoutineWebhookCard({ routineId, name }: { routineId: string; name: string }) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const url = new URL(appPath(routineEventsPath(routineId)), window.location.origin).href;
  const [secret, setSecret] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  async function reveal() {
    setRevealing(true);
    setUnavailable(false);
    try {
      const result = await rpc.routines.revealWebhookSecret({ routineId });
      setSecret(result.secret);
    } catch {
      setUnavailable(true);
    } finally {
      setRevealing(false);
    }
  }
  return (
    <section className="grid max-w-full gap-2 rounded-[20px] border border-border p-3 text-sm">
      <h3 className="font-medium">{name}</h3>
      <p className="break-all text-muted-foreground" dir="ltr">{url}</p>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={url} label={t`Copy webhook URL`} />
        {secret ? <>
          <CopyButton value={secret} label={t`Copy secret`} />
          <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>{t`Hide secret`}</Button>
        </> : (
          <Button size="sm" variant="outline" disabled={revealing} onClick={() => void reveal()}>
            {t`Show secret once`}
          </Button>
        )}
      </div>
      {secret ? <p className="select-all break-all" dir="ltr">{secret}</p> : null}
      {unavailable ? <p role="status" className="text-muted-foreground">
        {t`The secret is unavailable. You can rotate it in the routine editor.`}
      </p> : null}
    </section>
  );
}

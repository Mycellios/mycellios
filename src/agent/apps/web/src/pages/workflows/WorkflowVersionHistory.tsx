import { useLingui } from "@lingui/react/macro";
import type { WorkflowVersion } from "@mycellios/contracts";
import { Button } from "@mycellios/ui-web";
import { useEffect, useState } from "react";
import type { RpcClient } from "../../lib/rpc";

export function WorkflowVersionHistory({
  client, id, version, locked, dirty, onRestore,
}: {
  client: RpcClient;
  id: string;
  version: number;
  locked: boolean;
  dirty: boolean;
  onRestore: (version: number) => Promise<void>;
}) {
  const { t, i18n } = useLingui();
  const [items, setItems] = useState<WorkflowVersion[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [target, setTarget] = useState<number | null>(null);

  useEffect(() => {
    let current = true;
    client.workflows.versions({ id }).then(
      versions => { if (current) setItems(versions); },
      () => { if (current) setFailed(true); },
    );
    return () => { current = false; };
  }, [client, id, version, attempt]);

  return (
    <section aria-label={t`Version history`} className="rk-scroll max-h-52 shrink-0 overflow-y-auto border-b border-border p-3 text-xs">
      {failed ? (
        <div className="flex items-center gap-2" role="alert">
          {t`Could not load workflow versions.`}
          <Button size="xs" variant="ghost" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>{t`Retry`}</Button>
        </div>
      ) : items === null ? <p role="status">{t`Loading workflow versions…`}</p> : !items.length ? (
        <p>{t`No saved versions yet.`}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map(item => (
            <li key={item.version} className="flex min-h-9 flex-wrap items-center gap-2 py-1">
              <span>{t`Version`} {item.version}</span>
              <span className="min-w-0 break-words font-medium">{item.name}</span>
              <time className="text-muted-foreground" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(i18n.locale || "en")}</time>
              {item.version !== version ? (
                <Button size="xs" variant="ghost" className="ms-auto" disabled={dirty || locked} onClick={() => setTarget(item.version)}>{t`Restore`}</Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {dirty ? <p className="mt-2 text-muted-foreground">{t`Save your edits before restoring a version.`}</p> : null}
      {target !== null && !dirty ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p>{t`Restore version ${target} and pause its schedule?`}</p>
          <Button size="xs" variant="ghost" disabled={locked} onClick={() => setTarget(null)}>{t`Cancel`}</Button>
          <Button size="xs" disabled={locked} onClick={() => { setTarget(null); void onRestore(target); }}>{t`Confirm restore`}</Button>
        </div>
      ) : null}
    </section>
  );
}

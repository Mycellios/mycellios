import type { HostedWebDraft, HostedWebSnapshot } from "@rakazo/contracts";
import { Button, Disclosure } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import type { createSpaceRpc } from "../../lib/rpc";
import { issue } from "./hosted-web-files";

const SOURCE: Record<HostedWebSnapshot["source"], string> = {
  manual: "Guardado por ti",
  mico: "Editado por tu Mico",
  restore: "Restaurada",
};
const when = (iso: string) =>
  new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
const size = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;

/**
 * Private draft history. Restoring creates a new draft version (also recorded), so
 * nothing is lost; it never changes the published app.
 */
export function DraftHistory({
  client,
  draft,
  dirty,
  disabled,
  onRestored,
}: {
  client: ReturnType<typeof createSpaceRpc>;
  draft: HostedWebDraft;
  dirty: boolean;
  disabled: boolean;
  onRestored: (next: HostedWebDraft, from: HostedWebSnapshot) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<HostedWebSnapshot[] | null>(null);
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState("");
  useEffect(() => {
    if (!open || draft.version === 0) return;
    let live = true;
    client.webs.history
      .list({ id: draft.id })
      .then((value) => {
        if (live) {
          setRows(value);
          setError("");
        }
      })
      .catch((cause) => {
        if (live) setError(issue(cause));
      });
    return () => {
      live = false;
    };
  }, [client, open, draft.id, draft.version]);
  async function restore(row: HostedWebSnapshot) {
    setRestoring(row.id);
    setError("");
    try {
      onRestored(
        await client.webs.history.restore({
          id: draft.id,
          snapshotId: row.id,
          version: draft.version,
        }),
        row,
      );
    } catch (cause) {
      setError(issue(cause));
    } finally {
      setRestoring("");
    }
  }
  return (
    <Disclosure
      className="hw-history"
      summary="Historial de versiones"
      open={open}
      onOpenChange={setOpen}
    >
      {draft.version === 0 ? (
        <p className="hw-caption">Guarda el borrador para empezar el historial.</p>
      ) : (
        <>
          <p className="hw-caption">
            Se guardan las últimas 50 versiones del borrador. Restaurar crea una versión nueva y no
            cambia la app publicada.
          </p>
          {dirty && (
            <p className="hw-caption" role="status">
              Guarda o descarta tus cambios antes de restaurar.
            </p>
          )}
          {error && (
            <p className="hw-error" role="alert">
              {error}
            </p>
          )}
          {rows === null && !error ? <p className="hw-caption">Cargando…</p> : null}
          <ol className="hw-history-list">
            {rows?.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>v{row.version}</strong> · {SOURCE[row.source]}
                  <small>
                    {when(row.createdAt)} · {size(row.bytes)} · {row.title}
                  </small>
                </div>
                {row.current ? (
                  <span className="hw-caption">Actual</span>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={disabled || dirty || Boolean(restoring)}
                    aria-label={`Restaurar la versión ${row.version}`}
                    onClick={() => void restore(row)}
                  >
                    {restoring === row.id ? "Restaurando…" : "Restaurar"}
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </Disclosure>
  );
}

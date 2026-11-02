import { useLingui } from "@lingui/react/macro";
import { Button, Input } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { desktopBridge } from "../lib/desktop";
import { useReviewWorkspace } from "../lib/review-workspace";

export function LocalProject({ botId, onOpened }: { botId: string; onOpened: () => Promise<void> }) {
  const { t } = useLingui();
  const computer = desktopBridge()?.computer;
  const review = useReviewWorkspace();
  const [available, setAvailable] = useState(false);
  const [connected, setConnected] = useState(false);
  const [project, setProject] = useState<{ name: string; path: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  useEffect(() => {
    let disposed = false;
    setProject(null);
    setConnected(false);
    void computer?.projectAvailable?.().then(async (allowed) => {
      const selected = allowed ? await computer.project?.(botId) : null;
      const linked = allowed ? await computer.connected?.(botId) : false;
      if (!disposed) { setAvailable(allowed); setProject(selected ?? null); setConnected(linked ?? false); }
    }).catch(() => { if (!disposed) setAvailable(false); });
    return () => { disposed = true; };
  }, [botId, computer]);
  if (!available || !computer?.chooseProject) return null;
  async function connect() {
    setBusy(true); setError("");
    try {
      if (!await computer!.requestAccess()) return;
      await computer!.connect!(botId);
      await onOpened();
      setConnected(await computer!.connected!(botId));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t`Could not continue`); }
    finally { setBusy(false); }
  }
  async function choose() {
    setBusy(true); setError("");
    try {
      if (!await computer!.requestAccess()) return;
      const selected = await computer!.chooseProject!(botId);
      if (selected) { await onOpened(); setProject(selected); setConnected(await computer!.connected?.(botId) ?? false); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : t`Could not continue`); }
    finally { setBusy(false); }
  }
  const direct = Boolean(computer.connect && computer.connected);
  return <section className="mt-6 min-w-0 space-y-3" aria-label={t`Local project`}>
    {direct && <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-sm">{t`This computer`}</span>
      {connected ? <span role="status" className="text-sm text-muted-foreground">{t`Connected`}</span>
        : <Button variant="secondary" disabled={busy} onClick={() => void connect()}>{busy ? t`Connecting…` : t`Use this computer`}</Button>}
    </div>}
    <details open={direct ? undefined : true}>
      {direct && <summary className="cursor-pointer text-sm text-muted-foreground">{t`Project and preview`}</summary>}
      <div className={direct ? "mt-3 space-y-3" : "space-y-3"}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="min-w-0 truncate text-sm" title={project?.path}>{project?.name ?? t`Local project`}</span>
      <Button variant="secondary" disabled={busy} onClick={() => void choose()}>{t`Open project`}</Button>
    </div>
    {(project || connected) && <form className="flex min-w-0 flex-wrap gap-2" onSubmit={(event) => {
      event.preventDefault(); setError("");
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(parsed.hostname)
          || parsed.username || parsed.password || !parsed.port || Number(parsed.port) < 1024)
          throw new Error(t`Enter a local preview URL.`);
        review?.add({ id: `project:${botId}`, name: project?.name ?? t`This computer`, mimeType: "text/html", url: parsed.href });
      } catch { setError(t`Enter a local preview URL.`); }
    }}>
      <Input className="min-w-0 flex-1" aria-label={t`Preview URL`} placeholder="http://localhost:3000" value={url} onChange={(event) => setUrl(event.target.value)} />
      <Button type="submit" variant="secondary">{t`Preview`}</Button>
    </form>}
      </div>
    </details>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}

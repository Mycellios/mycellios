import { useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { CircleCheck, Plus, Server } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { desktopBridge } from "../../lib/desktop";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";

type Directory = { servers: { name: string; serverUrl: string }[]; current: string | null };
export function BillingServers() {
  const { t } = useLingui(); const bridge = desktopBridge()?.servers;
  const [data, setData] = useState<Directory>(); const [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  const locked = useRef(false), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { let active = true; setError("");
    if (bridge) void bridge.list().then(next => { if (active) setData(next); }).catch(() => { if (active) { setData(undefined); setError(t`Could not load servers.`); } });
    return () => { active = false; };
  }, [bridge, attempt]);
  async function manage(url?: string) {
    if (!bridge || locked.current) return; locked.current = true; setBusy(true); setError("");
    try { await bridge.manage(url); if (live.current) setAttempt(value => value + 1); }
    catch { if (live.current) setError(t`Finish active tasks, save drafts and end calls before changing servers.`); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  }
  return <section data-slot="settings-section" className="space-y-3" aria-label={t`Servers`}>
    <div className="flex flex-wrap items-center justify-between gap-3 px-1"><h3 className="text-sm font-medium">{t`Servers`}</h3>
      {bridge && <Button variant="outline" size="sm" disabled={busy} onClick={() => void manage()}><Plus aria-hidden size={14} />{t`Add server`}</Button>}
    </div>
    <p className="px-1 text-sm text-muted-foreground">{t`Each server manages its own account and billing. Adding a connection does not purchase a plan.`}</p>
    {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p><Button variant="outline" size="sm" disabled={busy} onClick={() => setAttempt(value => value + 1)}>{t`Retry`}</Button></div>}
    {bridge ? data ? data.servers.length ? <SettingsGroup>{data.servers.map(entry => <SettingsRow key={entry.serverUrl}
      label={<span className="inline-flex min-w-0 items-center gap-3"><Server aria-hidden size={16} /><span className="min-w-0 break-words">{entry.name}</span></span>}
      description={new URL(entry.serverUrl).origin}
      control={entry.serverUrl === data.current ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CircleCheck aria-hidden size={14} />{t`Current`}</span> : <Button variant="outline" size="sm" disabled={busy} onClick={() => void manage(entry.serverUrl)}>{t`Open`}</Button>} />)}</SettingsGroup>
      : <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{t`No saved servers yet.`}</p>
      : !error && <p role="status" className="text-sm text-muted-foreground">{t`Loading…`}</p>
      : <SettingsGroup><SettingsRow label={t`Current server`} description={window.location.origin} control={<span className="text-xs text-muted-foreground">{t`Web app`}</span>} />
        <SettingsRow label={t`Connect another server`} description={t`Use Mycellios Desktop to save and switch between servers.`} control={<a className="text-sm underline underline-offset-4" href="https://mycellios.com/downloads/desktop">{t`Download Desktop`}</a>} /></SettingsGroup>}
  </section>;
}

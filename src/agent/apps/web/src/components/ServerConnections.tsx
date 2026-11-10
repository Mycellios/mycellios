import { useLingui } from "@lingui/react/macro";
import type { DesktopSetup } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { CheckCircle2, PlusCircle, Server, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { desktopBridge } from "../lib/desktop";
function serverName(entry: DesktopSetup & {name:string}) { const url=new URL(entry.serverUrl); return entry.name === url.host && ["127.0.0.1","localhost","[::1]"].includes(url.hostname) ? "Mycellios local" : entry.name; }
export function ServerConnections({ rail = false }: { rail?: boolean }) {
  const { t } = useLingui(); const bridge = desktopBridge()?.servers;
  const [data, setData] = useState<{servers:(DesktopSetup & {name:string})[];current:string|null}>();
  const [view,setView] = useState(() => { try { return localStorage.getItem("mycellios.server-view") === "rail" ? "rail" : "menu"; } catch { return "menu"; } });
  useEffect(() => { const sync = () => { try {setView(localStorage.getItem("mycellios.server-view") === "rail" ? "rail" : "menu");} catch {} }; window.addEventListener("mycellios:server-view",sync); return () => window.removeEventListener("mycellios:server-view",sync); },[]);
  const [error,setError] = useState(""); const [busy,setBusy] = useState(false);
  useEffect(() => { let active = true; if (bridge) void bridge.list().then(value => { if(active)setData(value); }).catch(() => { if(active)setError(t`Could not load servers.`); }); return () => {active=false;}; },[bridge]);
  if (!bridge) return null;
  async function manage(url?: string) { setBusy(true); setError(""); try { await bridge!.manage(url); } catch { setError(t`Finish active tasks, save drafts and end calls before changing servers.`); } finally {setBusy(false);} }
  if (rail && view !== "rail") return null;
  return <section data-testid="desktop-server-menu" className={rail ? "app-no-drag flex w-full gap-1 overflow-x-auto py-1" : "flex flex-col gap-1 border-b border-border pb-1"}>
    {!rail && <p className="px-3 py-1 text-xs text-muted-foreground">{t`Servers`}</p>}
    {data?.servers.map(entry => <Button key={entry.serverUrl} variant="ghost" className="justify-start" disabled={busy} aria-label={serverName(entry)} title={`${entry.name} · ${entry.serverUrl}`} onClick={() => void manage(entry.serverUrl)}>
      {data.current === entry.serverUrl ? <CheckCircle2 size={15}/> : <Server size={15}/>}
      {!rail && <span className="truncate">{serverName(entry)}</span>}
    </Button>)}
    <Button variant="ghost" className="justify-start" aria-label={t`Add a server`} disabled={busy} onClick={() => void manage()}><PlusCircle size={15}/>{!rail && t`Add a server`}</Button>
    {!rail && <><Button variant="ghost" className="justify-start" disabled={busy} onClick={() => void manage(data?.servers.find(entry => data.current === entry.serverUrl)?.serverUrl)}><Settings size={15}/>{t`Server settings`}</Button>
    <Button variant="ghost" className="justify-between" aria-pressed={view === "rail"} onClick={() => { try {localStorage.setItem("mycellios.server-view",view === "menu" ? "rail" : "menu"); window.dispatchEvent(new Event("mycellios:server-view"));} catch {setError(t`Could not save this preference.`);} }}>{t`Server view`}<span>{view === "rail" ? t`Sidebar` : t`Menu`}</span></Button></>}
    {error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{error}</p>}
  </section>;
}

export function ServerConnectionName({ fallback }: { fallback: string }) {
  const bridge = desktopBridge()?.servers; const [name,setName] = useState(fallback);
  useEffect(() => { let active = true; if(bridge) void bridge.list().then(data => {const current=data.servers.find(entry=>new URL(entry.serverUrl).origin === window.location.origin); if(active && current)setName(serverName(current));}).catch(()=>{});return()=>{active=false;}; },[bridge]);
  return <>{bridge ? name : fallback}</>;
}

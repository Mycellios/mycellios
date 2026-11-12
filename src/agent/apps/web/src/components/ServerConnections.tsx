import { useLingui } from "@lingui/react/macro";
import { Button, Popover, PopoverContent, PopoverTrigger, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@rakazo/ui-web";
import { Bell, BellOff, Check, ChevronRight, ChevronsUpDown, ExternalLink, PanelLeft, PlusCircle, Settings, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { desktopBridge } from "../lib/desktop";
import { appPath } from "../lib/app-path";
import { useQueryUserId } from "../lib/query";
import { rpc } from "../lib/rpc";
import { rememberNotificationSettings } from "../lib/account-notifications";
import { forgetBrowserServer, readBrowserServers, readServerView, safeServerUrl, saveBrowserServer, saveServerView, SERVER_CONNECTIONS_CHANGED, SERVER_VIEW_CHANGED, serverDisplayName, type SavedServer } from "../lib/server-connections";
import { openServerDialog } from "../lib/server-dialogs";
import "./server-connections.css";

const currentBrowserUrl = () => new URL(appPath("/"), location.origin).href.replace(/\/+$/, "");
function useServers() {
  const bridge = desktopBridge()?.servers;
  const [data, setData] = useState<{ servers: SavedServer[]; current: string | null }>();
  const [error, setError] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true, request = 0;
    const refresh = () => {
      const sequence = ++request;
      if (!bridge) { setData({ servers: readBrowserServers(currentBrowserUrl()), current: currentBrowserUrl() }); setError(false); return; }
      void bridge.list().then(value => { if (alive && sequence === request) { setData(value); setError(false); } }).catch(() => { if (alive && sequence === request) setError(true); });
    };
    refresh(); window.addEventListener(SERVER_CONNECTIONS_CHANGED, refresh); window.addEventListener("focus", refresh);
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === "mycellios.servers.v1") refresh(); };
    window.addEventListener("storage", storage);
    return () => { alive = false; window.removeEventListener(SERVER_CONNECTIONS_CHANGED, refresh); window.removeEventListener("focus", refresh); window.removeEventListener("storage", storage); };
  }, [bridge, revision]);
  return { bridge, data, error, retry: () => setRevision(v => v + 1) };
}

/** A saved connection never transfers authentication, grants access or buys hosting. */
export function ServerConnections({ rail = false }: { rail?: boolean }) {
  const { t } = useLingui(), userId = useQueryUserId();
  const { bridge, data, error: loadError, retry } = useServers();
  const [view, setView] = useState(readServerView), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), lock = useRef(false), alive = useRef(true);
  const owner = useRef(userId); owner.current = userId;
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setView(readServerView());
    window.addEventListener(SERVER_VIEW_CHANGED, sync); window.addEventListener("storage", sync);
    return () => { window.removeEventListener(SERVER_VIEW_CHANGED, sync); window.removeEventListener("storage", sync); };
  }, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setHover(null); }, [userId]);
  async function action(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await work(); } catch { if (alive.current) setError(t`Could not complete this action. Your connection has not changed.`); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function manage(url?: string) {
    if (bridge) { await bridge.manage(url); return; }
    if (!url) { openServerDialog({ kind: "add", ownerId: userId, currentUrl: currentBrowserUrl() }); return; }
    const target = data?.servers.find(entry => entry.serverUrl === url);
    if (!target || !safeServerUrl(url)) throw Error("Unknown connection");
    if (url === data?.current) { openServerDialog({ kind: "add", ownerId: userId, currentUrl: currentBrowserUrl() }); return; }
    window.open(url + "/app", "_blank", "noopener,noreferrer");
  }
  async function saveIdentity(entry: SavedServer, identity: { name: string; color: string }) {
    if (bridge) {
      if (!bridge.updateIdentity) throw Error("Update Desktop to edit connection metadata");
      await bridge.updateIdentity(entry.serverUrl, identity);
    } else saveBrowserServer({ ...entry, ...identity }, currentBrowserUrl());
    window.dispatchEvent(new Event(SERVER_CONNECTIONS_CHANGED));
  }
  function openSettings(server: SavedServer, initial: "general" | "notifications") {
    openServerDialog({ kind: "settings", ownerId: userId, server, initial,
      current: server.serverUrl === data?.current, canEdit: !bridge || Boolean(bridge.updateIdentity),
      save: identity => saveIdentity(server, identity), manage: () => manage(server.serverUrl) });
  }
  async function notifications(patch: { mutedUntil?: string | null; level?: "all" | "needs_me" | "off" }) {
    const account = owner.current;
    if (!account) return;
    const current = await rpc.notifications.settings();
    if (owner.current !== account || !alive.current) return;
    const saved = await rpc.notifications.saveSettings({ ...current, ...patch });
    if (owner.current !== account || !alive.current) return;
    rememberNotificationSettings(account, saved);
    window.dispatchEvent(new Event("mycellios:notifications-changed"));
  }
  function actions(entry: SavedServer) {
    const current = data?.current === entry.serverUrl;
    return <>
      <div className="px-2 py-1 text-xs text-muted-foreground">{serverDisplayName(entry)}</div>
      {current && userId && <>
        <DropdownMenuSub><DropdownMenuSubTrigger><BellOff size={15}/>{t`Mute`}</DropdownMenuSubTrigger><DropdownMenuSubContent className="rk-server-menu w-52">
          {[{ label: t`For 15 minutes`, duration: 900_000 }, { label: t`For 1 hour`, duration: 3_600_000 }, { label: t`For 3 hours`, duration: 10_800_000 }, { label: t`For 8 hours`, duration: 28_800_000 }, { label: t`For 24 hours`, duration: 86_400_000 }].map(item => <DropdownMenuItem key={item.duration} disabled={busy} onClick={() => void action(() => notifications({ mutedUntil: new Date(Date.now() + item.duration).toISOString() }))}>{item.label}</DropdownMenuItem>)}
          <DropdownMenuItem disabled={busy} onClick={() => void action(() => notifications({ mutedUntil: "9999-12-31T23:59:59.999Z" }))}>{t`Until I turn it back on`}</DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem disabled={busy} onClick={() => void action(() => notifications({ mutedUntil: null }))}>{t`Resume notifications`}</DropdownMenuItem>
        </DropdownMenuSubContent></DropdownMenuSub>
        <DropdownMenuSub><DropdownMenuSubTrigger><Bell size={15}/>{t`Notification settings`}</DropdownMenuSubTrigger><DropdownMenuSubContent className="rk-server-menu w-52">
          {[{ label: t`All activity`, value: "all" }, { label: t`Only when I’m needed`, value: "needs_me" }, { label: t`No alerts`, value: "off" }].map(item => <DropdownMenuItem key={item.value} disabled={busy} onClick={() => void action(() => notifications({ level: item.value as "all" | "needs_me" | "off" }))}>{item.label}</DropdownMenuItem>)}
          <DropdownMenuSeparator/><DropdownMenuItem onClick={() => openSettings(entry, "notifications")}>{t`More notification settings`}</DropdownMenuItem>
        </DropdownMenuSubContent></DropdownMenuSub><DropdownMenuSeparator/>
      </>}
      {!current && <DropdownMenuItem disabled={busy} onClick={() => void action(() => manage(entry.serverUrl))}><ExternalLink size={15}/>{bridge ? t`Connect` : t`Open in a new tab`}</DropdownMenuItem>}
      <DropdownMenuItem onClick={() => openSettings(entry, "general")}><Settings size={15}/>{t`Server settings`}</DropdownMenuItem>
      {rail && <><DropdownMenuSeparator/><DropdownMenuSub><DropdownMenuSubTrigger><PanelLeft size={15}/>{t`Server view`}</DropdownMenuSubTrigger><DropdownMenuSubContent className="rk-server-menu w-40"><DropdownMenuRadioGroup value={view} onValueChange={value => { try { saveServerView(value === "rail" ? "rail" : "menu"); } catch { setError(t`Could not save this preference.`); } }}><DropdownMenuRadioItem value="rail">{t`Bar`}</DropdownMenuRadioItem><DropdownMenuRadioItem value="menu">{t`Menu`}</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuSubContent></DropdownMenuSub></>}
      {!current && !bridge && <><DropdownMenuSeparator/><DropdownMenuItem onClick={() => void action(async () => forgetBrowserServer(entry.serverUrl, currentBrowserUrl()))}><Trash2 size={15}/>{t`Remove saved connection`}</DropdownMenuItem></>}
    </>;
  }
  const current = data?.servers.find(entry => entry.serverUrl === data.current);
  if (rail && view === "menu") return <Popover><PopoverTrigger className="flex size-9 items-center justify-center rounded-lg hover:bg-accent" aria-label={t`Servers`} title={current ? serverDisplayName(current) : t`Servers`}><span className="rk-server-mark" style={{ backgroundColor: current?.color ?? "#476b5c" }}/></PopoverTrigger><PopoverContent side="right" align="end" className="w-64 p-1"><ServerConnections/></PopoverContent></Popover>;
  return <section data-testid="desktop-server-menu" className={rail ? "rk-server-strip app-no-drag col-span-full" : "flex flex-col gap-0.5 border-b border-border pb-1 [&_button]:font-normal"}>
    {!rail && <p className="px-3 py-1 text-xs text-muted-foreground">{t`Servers`}</p>}
    {loadError ? <div role="alert" className="px-3 py-2 text-xs text-destructive">{t`Could not load servers.`} <button type="button" className="underline" onClick={retry}>{t`Retry`}</button></div> : !data ? <p role="status" className="px-3 py-2 text-xs">{t`Loading…`}</p> : data.servers.map(entry => <DropdownMenu key={entry.serverUrl} open={hover === entry.serverUrl} onOpenChange={open => setHover(open ? entry.serverUrl : null)}>
      <DropdownMenuTrigger className={rail ? "flex size-8 items-center justify-center rounded-lg hover:bg-accent" : "flex h-8 w-full items-center gap-2 rounded-md px-3 text-sm hover:bg-accent"} aria-label={serverDisplayName(entry)} title={serverDisplayName(entry)} openOnHover={!rail} delay={150} closeDelay={200} onClick={event => { if (!rail && entry.serverUrl !== data.current) { event.preventDefault(); void action(() => manage(entry.serverUrl)); } }} onKeyDown={event => { if (!rail && (event.key === "Enter" || event.key === " ") && entry.serverUrl !== data.current) { event.preventDefault(); void action(() => manage(entry.serverUrl)); } }}>
        {!rail && <span className="flex size-4 items-center justify-center">{data.current === entry.serverUrl && <Check size={13}/>}</span>}
        <span className="rk-server-mark" style={{ backgroundColor: entry.color ?? "#476b5c" }} />{!rail && <><span className="min-w-0 flex-1 truncate text-start">{serverDisplayName(entry)}</span><ChevronRight size={13}/></>}
      </DropdownMenuTrigger><DropdownMenuContent side="right" className="rk-server-menu w-60">{actions(entry)}</DropdownMenuContent>
    </DropdownMenu>)}
    <Button variant="ghost" className={rail ? "size-8 p-0" : "justify-start px-3 text-sm font-normal"} aria-label={t`Add a server`} disabled={busy} onClick={() => void action(() => manage())}><PlusCircle size={15}/>{!rail && t`Add a server`}</Button>
    {!rail && <><div className="my-1 border-t border-border"/>
      <Button variant="ghost" className="justify-start px-3 text-sm font-normal" disabled={loadError || !current} onClick={() => { if (current) openSettings(current, "general"); }}><Settings size={15}/>{t`Server settings`}</Button>
      <DropdownMenu><DropdownMenuTrigger className="flex h-8 items-center gap-2 rounded-md px-3 text-sm hover:bg-accent"><PanelLeft size={15}/>{t`Server view`}<span className="ms-auto text-xs text-muted-foreground">{view === "rail" ? t`Bar` : t`Menu`}</span><ChevronRight size={13}/></DropdownMenuTrigger>
        <DropdownMenuContent side="right" className="rk-server-menu w-40"><DropdownMenuRadioGroup value={view} onValueChange={value => { try { saveServerView(value === "rail" ? "rail" : "menu"); } catch { setError(t`Could not save this preference.`); } }}>
          <DropdownMenuRadioItem value="rail"><PanelLeft size={15}/>{t`Bar`}</DropdownMenuRadioItem><DropdownMenuRadioItem value="menu"><ChevronsUpDown size={15}/>{t`Menu`}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup></DropdownMenuContent>
      </DropdownMenu>
    </>}
    {error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{error}</p>}
  </section>;
}

export function ServerConnectionName({ fallback }: { fallback: string }) {
  const { data } = useServers();
  const current = data?.servers.find(entry => entry.serverUrl === data.current);
  return <>{current ? serverDisplayName(current) : fallback}</>;
}

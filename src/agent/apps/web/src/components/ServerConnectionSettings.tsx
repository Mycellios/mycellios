import { useLingui } from "@lingui/react/macro";
import { Button, Dialog, DialogContent, DialogTitle, Input } from "@rakazo/ui-web";
import { Bell, Plug, Settings, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NotificationsPanel } from "../pages/settings/NotificationsPanel";
import { serverDisplayName, type SavedServer } from "../lib/server-connections";
import { SettingsGroup, SettingsRow } from "./SettingsRows";
import "./server-connections.css";

const colors = ["#476b5c", "#c67b37", "#547fab", "#9673a9", "#ae6266", "#65707b"];
export function ServerConnectionSettings({ server, current, userId, initial = "general", canEdit, onSave, onManage, onClose }: {
  server: SavedServer; current: boolean; userId: string | null;
  initial?: "general" | "notifications"; canEdit: boolean;
  onSave(identity: { name: string; color: string }): Promise<void>;
  onManage(): Promise<void>; onClose(): void;
}) {
  const { t } = useLingui();
  const [section, setSection] = useState<"general" | "notifications" | "connection">(initial);
  const [search, setSearch] = useState("");
  const [name, setName] = useState(serverDisplayName(server)), [color, setColor] = useState(server.color ?? colors[0]!);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const alive = useRef(true), lock = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const dirty = name.trim() !== serverDisplayName(server) || color !== (server.color ?? colors[0]);
  const items = [{ id: "general", label: t`General`, icon: Settings }, { id: "notifications", label: t`Notifications`, icon: Bell }, { id: "connection", label: t`Connection`, icon: Plug }] as const;
  async function save() {
    if (lock.current || !name.trim()) return;
    lock.current = true; setBusy(true); setError("");
    try { await onSave({ name: name.trim(), color }); if (alive.current) onClose(); }
    catch { if (alive.current) setError(t`Could not save this preference.`); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function manage() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await onManage(); if (alive.current) onClose(); }
    catch { if (alive.current) setError(t`Finish active tasks, save drafts and end calls before changing servers.`); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  function requestClose() { if (busy) return; if (dirty) setDiscard(true); else onClose(); }
  return <Dialog open onOpenChange={(open, details) => { if (!open && (busy || dirty)) { details.cancel(); if (dirty) setDiscard(true); } else if (!open) onClose(); }}>
    <DialogContent className="rk-server-settings" showCloseButton={false}>
      <aside className="rk-server-settings-nav">
        <DialogTitle className="flex items-center gap-2 px-2 text-sm font-normal"><span className="rk-server-mark" style={{ backgroundColor: color }} />{serverDisplayName(server)}</DialogTitle>
        <Input aria-label={t`Search settings`} placeholder={t`Search settings`} value={search} onChange={e => setSearch(e.target.value)} className="mt-4 mb-2 h-8 rounded-full text-xs" />
        <nav aria-label={t`Server settings`}>{items.filter(item => item.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map(item => <Button key={item.id} variant="ghost" className="w-full justify-start gap-2 text-sm font-normal" aria-current={section === item.id ? "page" : undefined} disabled={busy} onClick={() => setSection(item.id)}><item.icon size={15}/>{item.label}</Button>)}</nav>
      </aside>
      <div className="rk-server-settings-body">
        <header className="flex items-center justify-between border-b border-border px-5 py-3"><span className="text-sm">{items.find(item => item.id === section)?.label}</span><Button variant="ghost" size="icon-sm" aria-label={t`Close`} disabled={busy} onClick={requestClose}><X size={17}/></Button></header>
        <div className="rk-server-settings-scroll">
          {section === "general" && <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-6">
            <SettingsGroup title={t`Identity`}>
              <SettingsRow label={<label htmlFor="server-display-name">{t`Server name`}</label>} description={t`How this connection appears on this device.`} control={<Input id="server-display-name" className="w-56" maxLength={80} value={name} disabled={busy || !canEdit} onChange={e => setName(e.target.value)}/>}/>
              <SettingsRow label={t`Server color`} description={t`Recognize each connection at a glance.`} control={<div className="flex gap-2">{colors.map(value => <button key={value} type="button" aria-label={value} aria-pressed={color === value} disabled={busy || !canEdit} onClick={() => setColor(value)} className="rk-server-swatch" style={{ backgroundColor: value }} />)}</div>} />
            </SettingsGroup>
            <p className="text-xs leading-relaxed text-muted-foreground">{t`Connection names and colors stay on this device. Shared Space settings and permissions are managed separately.`}</p>
            {canEdit && dirty && <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => { setName(serverDisplayName(server)); setColor(server.color ?? colors[0]!); }}>{t`Cancel`}</Button><Button type="submit" disabled={busy || !name.trim()}>{busy ? t`Saving…` : t`Save`}</Button></div>}
          </form>}
          {section === "notifications" && (current && userId ? <NotificationsPanel scope={userId} onBusyChange={setBusy} /> : <SettingsGroup><SettingsRow label={t`Connect to this server to manage notifications.`} control={<Button variant="outline" onClick={() => void manage()} disabled={busy}>{t`Connect`}</Button>} /></SettingsGroup>)}
          {section === "connection" && <div className="space-y-6"><SettingsGroup title={t`Connection`}><SettingsRow label={t`Server address`}><code className="mt-2 block break-all text-xs text-muted-foreground">{server.serverUrl}</code></SettingsRow><SettingsRow label={current ? t`Current server` : t`Saved server`} description={t`Each server keeps its own sign-in, conversations and permissions.`} control={<Button variant="outline" disabled={busy} onClick={() => void manage()}>{current ? t`Manage connection` : t`Connect`}</Button>} /></SettingsGroup><p className="text-xs text-muted-foreground">{t`Changing a connection never moves or deletes your conversations.`}</p></div>}
          {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
          {discard && <div role="alert" className="mt-4 rounded-lg border border-border p-4"><p className="text-sm">{t`Discard unsaved connection changes?`}</p><div className="mt-3 flex justify-end gap-2"><Button variant="ghost" onClick={() => setDiscard(false)}>{t`Keep editing`}</Button><Button onClick={onClose}>{t`Discard changes`}</Button></div></div>}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}

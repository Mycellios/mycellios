import { useLingui } from "@lingui/react/macro";
import { Button, Dialog, DialogContent, DialogTitle, Input } from "@rakazo/ui-web";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { closeServerDialog, serverDialogSnapshot, subscribeServerDialog, type ServerDialog } from "../lib/server-dialogs";
import { safeServerUrl, saveBrowserServer } from "../lib/server-connections";
import { ServerConnectionSettings } from "./ServerConnectionSettings";

/** Mounted once by Shell, outside responsive sidebars and transient menus. */
export function ServerConnectionDialogs({ ownerId }: { ownerId: string | null }) {
  const request = useSyncExternalStore(subscribeServerDialog, serverDialogSnapshot, () => null);
  useEffect(() => {
    const current = serverDialogSnapshot(); if (current && current.ownerId !== ownerId) closeServerDialog(current.id);
    return () => { const current = serverDialogSnapshot(); if (current?.ownerId === ownerId) closeServerDialog(current.id); };
  }, [ownerId]);
  if (!request || request.ownerId !== ownerId) return null;
  return request.kind === "add" ? <AddServerDialog key={request.id} request={request}/>
    : <ServerConnectionSettings key={request.id} server={request.server} current={request.current} userId={ownerId} initial={request.initial} canEdit={request.canEdit} onSave={request.save} onManage={request.manage} onClose={() => closeServerDialog(request.id)}/>;
}
function AddServerDialog({ request }: { request: Extract<ServerDialog, { kind: "add" }> }) {
  const { t } = useLingui();
  const [address, setAddress] = useState(""), [name, setName] = useState("");
  const [error, setError] = useState("");
  const lock = useRef(false);
  function save() {
    if (lock.current || serverDialogSnapshot()?.id !== request.id) return;
    lock.current = true;
    try {
      const url = safeServerUrl(address); if (!url) throw Error("Invalid connection");
      saveBrowserServer({ mode: "existing", serverUrl: url, name: name.trim() || new URL(url).host }, request.currentUrl);
      closeServerDialog(request.id);
    } catch { setError(t`Could not save this preference.`); }
    finally { lock.current = false; }
  }
  return <Dialog open onOpenChange={open => { if (!open) closeServerDialog(request.id); }}><DialogContent><DialogTitle>{t`Add a server`}</DialogTitle><p className="text-sm text-muted-foreground">{t`Connect to another Mycellios. Your current chat stays open.`}</p><form className="space-y-4" onSubmit={event => { event.preventDefault(); save(); }}>
    <label className="block space-y-1"><span className="text-sm">{t`Name`}</span><Input value={name} maxLength={80} onChange={e => setName(e.target.value)}/></label>
    <label className="block space-y-1"><span className="text-sm">{t`Server address`}</span><Input type="url" value={address} placeholder="https://" required onChange={e => setAddress(e.target.value)}/></label>
    <p className="text-xs text-muted-foreground">{t`Public servers require HTTPS. Sign in separately on the new server.`}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => closeServerDialog(request.id)}>{t`Cancel`}</Button><Button type="submit" disabled={!safeServerUrl(address)}>{t`Add`}</Button></div>
  </form></DialogContent></Dialog>;
}

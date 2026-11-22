import { useLingui } from "@lingui/react/macro";
import type { InboxTask } from "@mycellios/contracts";
import { Button, Input } from "@mycellios/ui-web";
import { Bell, Pin, PinOff, X } from "lucide-react";
import { useState } from "react";
import type { RpcClient } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

export function reminderTime(value: string) {
  return new Date(value).toLocaleString(undefined,{dateStyle:"short",timeStyle:"short"});
}
export function TaskFollowUp({item,client,onChanged}:{item:InboxTask;client:RpcClient;onChanged:()=>void}) {
  const {t}=useLingui();
  const [open,setOpen]=useState(false),[date,setDate]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function save(change:{pinned?:boolean;remindAt?:string|null}) {
    if(busy)return;
    setBusy(true);setError("");
    try {await client.taskInbox.followUp({id:item.id,...change});setOpen(false);onChanged();}
    catch(cause){setError(errorText(cause));}
    finally{setBusy(false);}
  }
  const due=Boolean(item.remindAt&&Date.parse(item.remindAt)<=Date.now());
  return <div className="rk-task-followup">
    <div className="rk-task-followup-actions">
      <Button size="xs" variant="ghost" aria-pressed={Boolean(item.pinned)} disabled={busy||Boolean(item.archivedAt)} onClick={()=>void save({pinned:!item.pinned})}>
        {item.pinned?<PinOff size={13}/>:<Pin size={13}/>}{item.pinned?t`Unpin conversation`:t`Pin conversation`}
      </Button>
      <Button size="xs" variant="ghost" aria-expanded={open} disabled={busy||Boolean(item.archivedAt)} onClick={()=>setOpen(!open)}><Bell size={13}/>{t`Remind me`}</Button>
    </div>
    {item.remindAt?<div className={`rk-task-reminder ${due?"rk-task-reminder-due":""}`} role={due?"status":undefined}>
      <Bell size={13}/><span>{due?t`Time to continue`:t`Reminder set`} · {reminderTime(item.remindAt)}</span>
      <Button size="icon-xs" variant="ghost" disabled={busy} aria-label={t`Dismiss reminder`} onClick={()=>void save({remindAt:null})}><X size={13}/></Button>
    </div>:null}
    {open?<form className="rk-task-reminder-form" onSubmit={event=>{event.preventDefault();const at=new Date(date);if(!Number.isFinite(at.getTime())||at.getTime()<=Date.now()){setError(t`Choose a future date and time.`);return;}void save({remindAt:at.toISOString()});}}>
      <p>{t`When should we remind you?`}</p>
      <div className="rk-task-followup-actions">
        <Button size="xs" variant="secondary" disabled={busy} onClick={()=>void save({remindAt:new Date(Date.now()+600000).toISOString()})}>{t`In 10 minutes`}</Button>
        <Button size="xs" variant="secondary" disabled={busy} onClick={()=>void save({remindAt:new Date(Date.now()+3600000).toISOString()})}>{t`In 1 hour`}</Button>
        <Button size="xs" variant="secondary" disabled={busy} onClick={()=>{const at=new Date();at.setDate(at.getDate()+1);at.setHours(9,0,0,0);void save({remindAt:at.toISOString()});}}>{t`Tomorrow at 9`}</Button>
      </div>
      <label>{t`Or choose a date and time`}<Input type="datetime-local" value={date} onChange={event=>setDate(event.target.value)} disabled={busy}/></label>
      <div className="rk-task-followup-actions"><Button type="submit" size="xs" disabled={busy||!date}>{t`Save reminder`}</Button><Button size="xs" variant="ghost" onClick={()=>setOpen(false)}>{t`Cancel`}</Button></div>
      <p className="rk-task-reminder-note">{t`Saved with this conversation. Device alerts follow your notification settings.`}</p>
    </form>:null}
    {error?<p role="alert" className="text-xs text-destructive">{error}</p>:null}
  </div>;
}

import {Trans, useLingui} from "@lingui/react/macro";
import type {RakazoDesktop} from "@mycellios/contracts";
import {Button} from "@mycellios/ui-web";
import {Code2, LoaderCircle, Square, Terminal} from "lucide-react";
import {useEffect, useRef, useState} from "react";
import {connectThisComputer, desktopBridge} from "../lib/desktop";
import {useDeveloperMode} from "../lib/developer-mode";

type DevStatus=NonNullable<Awaited<ReturnType<NonNullable<NonNullable<RakazoDesktop["development"]>["status"]>>>>;

function elapsed(ms:number) {
  const seconds=Math.max(0,Math.floor(ms/1000));
  return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`;
}

export function OpenMycelliosDev({botId}:{botId:string}) {
  const {t}=useLingui();
  const [developerMode]=useDeveloperMode();
  const [busy,setBusy]=useState(false);
  const [stopping,setStopping]=useState(false);
  const [status,setStatus]=useState<DevStatus|null>(null);
  const [details,setDetails]=useState(false);
  const [now,setNow]=useState(()=>Date.now());
  const [error,setError]=useState("");
  const pending=useRef(false),alive=useRef(true),reading=useRef(false);
  const logView=useRef<HTMLPreElement>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const bridge=desktopBridge()?.development;
  const open=bridge?.open,readStatus=bridge?.status,stopStack=bridge?.stop;
  const visible=developerMode && Boolean(open) && !bridge?.isDevelopment;
  // Native main owns the stack: a remounted button still sees one preparing or running.
  useEffect(()=>{
    if(!visible || !readStatus)return;
    let stopped=false;
    const read=async()=>{
      if(reading.current)return;
      reading.current=true;
      try {const value=await readStatus();if(!stopped){setStatus(value);setNow(Date.now());}}
      catch {/* Keep the last observation; the next poll retries. */}
      finally {reading.current=false;}
    };
    void read();
    const timer=setInterval(()=>{if(pending.current||document.visibilityState==="visible")void read();},1500);
    return ()=>{stopped=true;clearInterval(timer);};
  },[visible,readStatus]);
  const logs=status?.logs;
  // Follow new output only while the reader is already at the end.
  useEffect(()=>{
    const view=logView.current;
    if(view && view.scrollHeight-view.scrollTop-view.clientHeight<48)view.scrollTop=view.scrollHeight;
  },[logs,details]);
  if(!visible)return null;
  const preparing=busy||status?.state==="preparing";
  const running=!preparing && status?.state==="running";
  async function launch() {
    if(pending.current)return;
    pending.current=true;setBusy(true);setError("");
    try {
      await connectThisComputer(botId);
      if(!alive.current)return;
      const result=await open!(botId);
      if(!result.opened && !result.stopped)throw Error(result.error||t`Could not open Mycellios Dev. Try again.`);
    }catch(cause){if(alive.current){setError(cause instanceof Error?cause.message:t`Could not open Mycellios Dev. Try again.`);setDetails(true);}}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  async function stop() {
    setStopping(true);setError("");
    try {await stopStack!();if(alive.current)setStatus(value=>value&&{state:"stopped",logs:value.logs});}
    catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:t`Could not stop Mycellios Dev.`);}
    finally{if(alive.current)setStopping(false);}
  }
  const phase=status?.state==="preparing"?status.phase:undefined;
  const label=running?<Trans>Mycellios Dev is running</Trans>:!preparing?<Trans>Open Mycellios Dev</Trans>:
    stopping?<Trans>Stopping…</Trans>:
    phase==="installing"?<Trans>Installing dependencies…</Trans>:
    phase==="building"?<Trans>Building Mycellios Dev…</Trans>:
    phase==="starting"?<Trans>Starting services…</Trans>:
    phase==="opening"?<Trans>Opening window…</Trans>:
    <Trans>Preparing Mycellios Dev…</Trans>;
  return <>
    <div className="flex min-w-0 items-center gap-1">
      {/* Running: the same action brings the existing Dev window forward. */}
      <Button variant="ghost" data-mobile-chat-action data-testid="open-mycellios-dev" disabled={preparing||stopping} aria-busy={preparing}
        className="min-w-0 flex-1 justify-start gap-3 text-sm font-normal" onClick={()=>void launch()}>
        {preparing?<LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />:
          <Code2 size={16} className={running?"text-success":undefined} aria-hidden />}
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        {status?.state==="preparing"?<span className="shrink-0 tabular-nums text-xs text-muted-foreground">{elapsed(now-status.startedAt)}</span>:null}
      </Button>
      {stopStack && (preparing||running)?
        <Button variant="ghost" size="icon-sm" aria-label={t`Stop Mycellios Dev`} disabled={stopping} onClick={()=>void stop()}>
          <Square size={14} aria-hidden />
        </Button>:null}
      {status?.logs||error?
        <Button variant="ghost" size="icon-sm" aria-label={t`Mycellios Dev logs`} aria-expanded={details} onClick={()=>setDetails(value=>!value)}>
          <Terminal size={15} aria-hidden />
        </Button>:null}
    </div>
    {error?<p role="alert" className="px-3 text-xs text-destructive">{error}</p>:null}
    {details?
      <pre ref={logView} data-testid="mycellios-dev-logs" className="mx-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-[11px] leading-snug">
        {status?.logs||t`No output yet.`}
      </pre>:null}
  </>;
}

import {Trans, useLingui} from "@lingui/react/macro";
import {Button} from "@rakazo/ui-web";
import {Code2, LoaderCircle} from "lucide-react";
import {useEffect, useRef, useState} from "react";
import {connectThisComputer, desktopBridge} from "../lib/desktop";
import {useDeveloperMode} from "../lib/developer-mode";

export function OpenMycelliosDev({botId}:{botId:string}) {
  const {t}=useLingui();
  const [developerMode]=useDeveloperMode();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const pending=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const open=desktopBridge()?.development?.open;
  if(!developerMode || !open || desktopBridge()?.development?.isDevelopment)return null;
  async function launch() {
    if(pending.current)return;
    pending.current=true;setBusy(true);setError("");
    try {
      await connectThisComputer(botId);
      if(!alive.current)return;
      const result=await open!(botId);
      if(!result.opened)throw Error(result.error||t`Could not open Mycellios Dev. Try again.`);
    }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:t`Could not open Mycellios Dev. Try again.`);}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  return <>
    <Button variant="ghost" data-mobile-chat-action data-testid="open-mycellios-dev" disabled={busy}
      className="w-full justify-start gap-3 text-sm font-normal" onClick={()=>void launch()}>
      {busy?<LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />:<Code2 size={16} aria-hidden />}
      {busy?<Trans>Preparing Mycellios Dev…</Trans>:<Trans>Open Mycellios Dev</Trans>}
    </Button>
    {error?<p role="alert" className="px-3 text-xs text-destructive">{error}</p>:null}
  </>;
}

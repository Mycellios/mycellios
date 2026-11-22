import { Trans, useLingui } from "@lingui/react/macro";
import type { MessagePin, MicoMessagePin } from "@mycellios/contracts";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@mycellios/ui-web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pin, PinOff } from "lucide-react";
import { createContext, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import type { RpcClient } from "../lib/rpc";
import { errorText } from "../lib/user-error";

type PinTarget = {botId:string;taskThreadId?:string}|{groupId:string};
export type MessagePinActions = {ids:ReadonlySet<string>;busy:boolean;set:(messageId:string,pinned:boolean)=>void};
export const MessagePinsContext=createContext<MessagePinActions|null>(null);
/** Every pin query starts with this key, so a change in one list refreshes the other. */
const PINS_KEY="message-pins";

export function useMessagePins(rpc:RpcClient,scope:string,target:PinTarget|null,threadId:string|undefined) {
  const {t}=useLingui();
  const client=useQueryClient();
  const key=useMemo(()=>[PINS_KEY,scope,threadId] as const,[scope,threadId]);
  const query=useQuery({queryKey:key,enabled:Boolean(target&&threadId),queryFn:()=>rpc.threads.pinned(target!),refetchOnWindowFocus:true});
  const mutation=useMutation({mutationFn:async(input:{messageId:string;pinned:boolean})=>{
    if(!target||!threadId) throw Error("No conversation");
    return rpc.threads.setPin({...target,...input});
  },onSuccess:()=>client.invalidateQueries({queryKey:[PINS_KEY]}),onError:error=>toast.error(errorText(error,t`Could not update pinned messages.`))});
  const ids=useMemo(()=>new Set(query.data && query.data.threadId===threadId?query.data.pins.map(pin=>pin.messageId):[]),[query.data,threadId]);
  const set=useCallback((messageId:string,pinned:boolean)=>mutation.mutate({messageId,pinned}),[mutation.mutate]);
  const busy=query.isPending||query.isError||mutation.isPending;
  const actions=useMemo(()=>({ids,busy,set}),[ids,busy,set]);
  return {query,actions,pins:query.data && query.data.threadId===threadId?query.data.pins:[]};
}

/** The Mico whose conversations the combined view covers, and how to open another one. */
export type MicoPinsScope = {
  rpc:RpcClient;
  scope:string;
  botId:string;
  name:string;
  /** The conversation on screen; its pins jump in place. */
  threadId:string;
  /** Open another conversation of this Mico (restoring it if archived), then jump to the pin. */
  onOpen:(pin:MicoMessagePin)=>void;
};

function useMicoPins(mico:MicoPinsScope|undefined,enabled:boolean) {
  const {t}=useLingui();
  const client=useQueryClient();
  const query=useQuery({
    queryKey:[PINS_KEY,mico?.scope,"mico",mico?.botId],
    enabled:Boolean(mico&&enabled),
    queryFn:()=>mico!.rpc.pins.mico({botId:mico!.botId}),
  });
  const unpin=useMutation({
    mutationFn:(pin:MicoMessagePin)=>mico!.rpc.pins.unpin({botId:mico!.botId,threadId:pin.threadId,messageId:pin.messageId}),
    onSuccess:()=>client.invalidateQueries({queryKey:[PINS_KEY]}),
    onError:error=>toast.error(errorText(error,t`Could not update pinned messages.`)),
  });
  return {query,unpin};
}

function PinRow({pin,label,onOpen,onUnpin,unpinDisabled}:{pin:MessagePin;label?:string;onOpen:()=>void;onUnpin:()=>void;unpinDisabled:boolean}) {
  const {t,i18n}=useLingui();
  const byName=pin.pinnedByName;
  return <div className="group/pin flex items-start gap-1 rounded-md hover:bg-muted/60">
    <Button variant="ghost" className="h-auto min-w-0 flex-1 flex-col items-start gap-1 px-3 py-2 text-start" onClick={onOpen}>
      <span className="flex w-full justify-between gap-3 text-xs text-muted-foreground"><span className="min-w-0 truncate">{pin.role==="user"?t`You`:t`Mico`}{label?<span className="text-muted-foreground/80" dir="auto">{" · "}{label}</span>:null}</span><time className="shrink-0" dateTime={pin.createdAt}>{new Date(pin.createdAt).toLocaleDateString(i18n.locale||"en")}</time></span>
      <span className="line-clamp-3 w-full whitespace-pre-wrap break-words text-sm font-normal">{pin.preview||t`Attachment`}</span>
      {pin.pinnedByBotId?<span data-testid="pinned-by-mico" className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground"><Pin size={11} aria-hidden="true" />{byName?t`Pinned by ${byName}`:t`Pinned by your Mico`}</span>:null}
    </Button>
    <Button variant="ghost" size="icon-sm" className="me-1 mt-2 shrink-0 text-muted-foreground" aria-label={t`Unpin message`} title={t`Unpin message`} disabled={unpinDisabled} onClick={onUnpin}><PinOff size={14} aria-hidden="true" /></Button>
  </div>;
}

export function PinnedMessagesButton({state,onJump,mico}:{state:ReturnType<typeof useMessagePins>;onJump:(messageId:string)=>void;mico?:MicoPinsScope}) {
  const {t}=useLingui();
  const [open,setOpen]=useState(false);
  const [view,setView]=useState<"here"|"all">("here");
  const all=Boolean(mico)&&view==="all";
  const micoPins=useMicoPins(mico,open&&all);
  const name=mico?.name??"";
  const conversationLabel=(pin:MicoMessagePin)=>{
    const title=pin.taskThreadId===null?t`Main chat`:pin.conversationTitle||t`Untitled conversation`;
    return pin.archived?t`${title} (archived)`:title;
  };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button variant="ghost" size="icon-sm" className="relative shrink-0 text-muted-foreground" aria-label={t`Pinned messages`} title={t`Pinned messages`} />}>
      <Pin size={16} aria-hidden="true" />
      {state.pins.length>0?<span className="absolute end-1 bottom-1 size-1.5 rounded-full bg-foreground" aria-hidden="true" />:null}
    </PopoverTrigger>
    <PopoverContent align="end" className="max-h-[65dvh] w-96 max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto p-1">
      <h3 className="px-3 py-2 text-sm font-medium"><Trans>Pinned messages</Trans></h3>
      {mico?<fieldset aria-label={t`Show pins from`} className="mx-2 mb-1 flex min-w-0 gap-1 rounded-md border-0 bg-muted/60 p-0.5 text-xs">
        <Button size="sm" variant={view==="here"?"secondary":"ghost"} aria-pressed={view==="here"} className="h-7 flex-1 px-2 text-xs" onClick={()=>setView("here")}><Trans>This conversation</Trans></Button>
        <Button size="sm" variant={view==="all"?"secondary":"ghost"} aria-pressed={view==="all"} className="h-7 min-w-0 flex-1 truncate px-2 text-xs" onClick={()=>setView("all")}>{t`All of ${name}'s conversations`}</Button>
      </fieldset>:null}
      {all?(micoPins.query.isPending?<LoadingSkeleton rows={2} className="px-3 py-3" />
      :micoPins.query.isError?<div role="alert" className="space-y-2 px-3 py-3 text-sm"><p><Trans>Could not load pinned messages.</Trans></p><Button size="sm" variant="ghost" onClick={()=>void micoPins.query.refetch()}><Trans>Retry</Trans></Button></div>
      :micoPins.query.data.pins.length===0?<p className="px-3 py-3 text-sm leading-relaxed text-muted-foreground">{t`No pinned messages in ${name}'s conversations yet.`}</p>
      :<>{micoPins.query.data.pins.map(pin=><PinRow key={`${pin.threadId}:${pin.messageId}`} pin={pin} label={conversationLabel(pin)}
          unpinDisabled={micoPins.unpin.isPending} onUnpin={()=>micoPins.unpin.mutate(pin)}
          onOpen={()=>{setOpen(false);if(pin.threadId===mico!.threadId) onJump(pin.messageId); else mico!.onOpen(pin);}} />)}
        {micoPins.query.data.pins.length>=200?<p className="px-3 py-2 text-xs text-muted-foreground"><Trans>Showing the newest 200 pins.</Trans></p>:null}</>)
      :state.query.isPending?<LoadingSkeleton rows={2} className="px-3 py-3" />
      :state.query.isError?<div role="alert" className="space-y-2 px-3 py-3 text-sm"><p><Trans>Could not load pinned messages.</Trans></p><Button size="sm" variant="ghost" onClick={()=>void state.query.refetch()}><Trans>Retry</Trans></Button></div>
      :state.pins.length===0?<p className="px-3 py-3 text-sm leading-relaxed text-muted-foreground"><Trans>Pin a message from its menu to find it here.</Trans></p>
      :state.pins.map(pin=><PinRow key={pin.messageId} pin={pin} unpinDisabled={state.actions.busy}
          onUnpin={()=>state.actions.set(pin.messageId,false)} onOpen={()=>{setOpen(false);onJump(pin.messageId);}} />)}
    </PopoverContent>
  </Popover>;
}
import { LoadingSkeleton } from "./LoadingSkeleton";

import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@rakazo/ui-web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pin, PinOff } from "lucide-react";
import { createContext, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import type { RpcClient } from "../lib/rpc";
import { errorText } from "../lib/user-error";

type PinTarget = {botId:string;taskThreadId?:string}|{groupId:string};
export type MessagePinActions = {ids:ReadonlySet<string>;busy:boolean;set:(messageId:string,pinned:boolean)=>void};
export const MessagePinsContext=createContext<MessagePinActions|null>(null);

export function useMessagePins(rpc:RpcClient,scope:string,target:PinTarget|null,threadId:string|undefined) {
  const {t}=useLingui();
  const client=useQueryClient();
  const key=useMemo(()=>["message-pins",scope,threadId] as const,[scope,threadId]);
  const query=useQuery({queryKey:key,enabled:Boolean(target&&threadId),queryFn:()=>rpc.threads.pinned(target!),refetchOnWindowFocus:true});
  const mutation=useMutation({mutationFn:async(input:{messageId:string;pinned:boolean})=>{
    if(!target||!threadId) throw Error("No conversation");
    return rpc.threads.setPin({...target,...input});
  },onSuccess:()=>client.invalidateQueries({queryKey:key}),onError:error=>toast.error(errorText(error,t`Could not update pinned messages.`))});
  const ids=useMemo(()=>new Set(query.data && query.data.threadId===threadId?query.data.pins.map(pin=>pin.messageId):[]),[query.data,threadId]);
  const set=useCallback((messageId:string,pinned:boolean)=>mutation.mutate({messageId,pinned}),[mutation.mutate]);
  const busy=query.isPending||query.isError||mutation.isPending;
  const actions=useMemo(()=>({ids,busy,set}),[ids,busy,set]);
  return {query,actions,pins:query.data && query.data.threadId===threadId?query.data.pins:[]};
}

export function PinnedMessagesButton({state,onJump}:{state:ReturnType<typeof useMessagePins>;onJump:(messageId:string)=>void}) {
  const {t,i18n}=useLingui();
  const [open,setOpen]=useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button variant="ghost" size="icon-sm" className="relative shrink-0 text-muted-foreground" aria-label={t`Pinned messages`} title={t`Pinned messages`} />}>
      <Pin size={16} aria-hidden="true" />
      {state.pins.length>0?<span className="absolute end-1 bottom-1 size-1.5 rounded-full bg-foreground" aria-hidden="true" />:null}
    </PopoverTrigger>
    <PopoverContent align="end" className="max-h-[65dvh] w-96 max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto p-1">
      <h3 className="px-3 py-2 text-sm font-medium"><Trans>Pinned messages</Trans></h3>
      {state.query.isPending?<p role="status" className="px-3 py-3 text-sm text-muted-foreground"><Trans>Loading…</Trans></p>
      :state.query.isError?<div role="alert" className="space-y-2 px-3 py-3 text-sm"><p><Trans>Could not load pinned messages.</Trans></p><Button size="sm" variant="ghost" onClick={()=>void state.query.refetch()}><Trans>Retry</Trans></Button></div>
      :state.pins.length===0?<p className="px-3 py-3 text-sm leading-relaxed text-muted-foreground"><Trans>Pin a message from its menu to find it here.</Trans></p>
      :state.pins.map(pin=><div key={pin.messageId} className="group/pin flex items-start gap-1 rounded-md hover:bg-muted/60">
        <Button variant="ghost" className="h-auto min-w-0 flex-1 flex-col items-start gap-1 px-3 py-2 text-start" onClick={()=>{setOpen(false);onJump(pin.messageId);}}>
          <span className="flex w-full justify-between gap-3 text-xs text-muted-foreground"><span>{pin.role==="user"?t`You`:t`Mico`}</span><time dateTime={pin.createdAt}>{new Date(pin.createdAt).toLocaleDateString(i18n.locale||"en")}</time></span>
          <span className="line-clamp-3 w-full whitespace-pre-wrap break-words text-sm font-normal">{pin.preview||t`Attachment`}</span>
        </Button>
        <Button variant="ghost" size="icon-sm" className="me-1 mt-2 shrink-0 text-muted-foreground" aria-label={t`Unpin message`} title={t`Unpin message`} disabled={state.actions.busy} onClick={()=>state.actions.set(pin.messageId,false)}><PinOff size={14} aria-hidden="true" /></Button>
      </div>)}
    </PopoverContent>
  </Popover>;
}

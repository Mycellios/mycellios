import { ORPCError } from "@orpc/server";
import { MessageBlock, type Actor } from "@mycellios/contracts";
import { messageReplyPreview } from "@mycellios/core/message-quote";
import { listMessagePins, setMessagePin } from "@mycellios/db";
import { resolveThreadTarget } from "../thread-target.js";
import { loadMessagePage, withoutPeerRunMessages } from "../thread-message-pages.js";
import type { RouterContext } from "./context.js";

export function messagePinRoutes({deps,authed}: RouterContext) {
  return {
    pinned: authed.threads.pinned.handler(async ({context,input})=>{
      const target=await resolveThreadTarget(deps.prisma,context.actor,input,{includeArchived:true});
      const pins=await listMessagePins(deps.prisma,context.actor,target.threadId);
      if(!pins.length) return {threadId:target.threadId,pins:[]};
      const rows=await deps.prisma.message.findMany({where:{threadId:target.threadId,id:{in:pins.map(pin=>pin.messageId)},role:{in:["user","bot"]}}});
      const visible=await withoutPeerRunMessages(deps.prisma,rows);
      const byId=new Map(visible.map(message=>[message.id,message]));
      return {threadId:target.threadId,pins:pins.flatMap(pin=>{
        const message=byId.get(pin.messageId); if(!message) return [];
        const parsed=MessageBlock.array().safeParse(message.blocks);
        const preview=messageReplyPreview(parsed.success?parsed.data:[],message.role as "user"|"bot").text;
        return [{messageId:message.id,seq:message.seq,role:message.role as "user"|"bot",preview:preview.slice(0,800),createdAt:message.createdAt.toISOString(),pinnedAt:pin.pinnedAt.toISOString()}];
      })};
    }),
    setPin: authed.threads.setPin.handler(async ({context,input})=>{
      const target=await resolveThreadTarget(deps.prisma,context.actor,input,{includeArchived:true});
      const page=await loadMessagePage(deps.prisma,target.threadId,undefined,1,{messageId:input.messageId});
      if(!page.messages.some(message=>message.id===input.messageId && (message.role==="user"||message.role==="bot"))) throw new ORPCError("NOT_FOUND");
      try { await setMessagePin(deps.prisma,context.actor as Actor,target.threadId,input.messageId,input.pinned); }
      catch(error) {
        if(error instanceof Error && error.message==="You can pin up to 100 messages per conversation.")
          throw new ORPCError("BAD_REQUEST",{message:error.message});
        throw error;
      }
      return {ok:true as const};
    }),
  };
}

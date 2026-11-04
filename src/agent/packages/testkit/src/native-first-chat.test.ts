import { expect, it, vi } from "vitest";
import { initialComputerAssignmentFilter } from "../../../apps/api/src/initial-computer-assignment";
import { nativeComputerAdmission, nativeComputerFetch } from "../../../apps/web/src/lib/native-computer-execution";
import { prepareNativeWorkspace } from "../../../apps/web/src/lib/native-computer-workspace";
import { NATIVE_PROJECT_INSTRUCTIONS } from "../../../apps/web/src/lib/native-project-instructions";

it.each([
  {status:"waiting_input",trigger:"created",allowed:true},
  {status:"waiting_input",trigger:"user",allowed:false},
  {status:"running",trigger:"created",allowed:false},
])("admits a first chat only when its pending work is an idle greeting: %j", async run => {
  let mode="team";
  const order:string[]=[];
  const computerRecord={scope:"team",kind:"desktop",providerRef:"native-binding",controlHolder:"bot",controlBotId:null,executionRunId:null,executionBotId:null,executionLeaseExpiresAt:null};
  const bot=()=>({id:"new-bot",computerMode:mode,instructions:NATIVE_PROJECT_INSTRUCTIONS});
  const send=vi.fn<typeof fetch>(async(input,init)=>{
    const url=String(input);
    if(url.endsWith("/bots/get"))return Response.json({json:bot()});
    if(url.endsWith("/bots/setComputer")){
      expect(new Headers(init?.headers).get("x-rakazo-space-id")).toBe("owned-space");
      const filter=initialComputerAssignmentFilter(computerRecord,"dedicated");
      const excluded=filter.NOT?.status===run.status && filter.NOT?.trigger===run.trigger;
      if(!excluded)return Response.json({json:{code:"BAD_REQUEST",message:"Stop the bot first"}},{status:400});
      mode="dedicated";order.push("assigned");return Response.json({json:bot()});
    }
    order.push("message");return Response.json({ok:true});
  });
  const native={projectAvailable:vi.fn(async()=>true),requestAccess:vi.fn(async()=>true),revokeAccess:vi.fn(async()=>{}),onConfigure:vi.fn(()=>()=>{}),connected:vi.fn(async()=>true),connect:vi.fn(async()=>{expect(mode).toBe("dedicated");order.push("connected");})};
  // Older clients explicitly assigned a private record. Keep their server-side
  // compatibility separate from modern send preparation, which preserves mode.
  const prepareLegacyAssignment = async (botId: string) => {
    const response = await send("https://example.test/agent/rpc/bots/setComputer", {
      headers: { "x-rakazo-space-id": "owned-space" },
      body: JSON.stringify({json:{botId,mode:"dedicated"}}),
    });
    if (!response.ok) throw new Error("assignment refused");
  };
  const admit=nativeComputerAdmission(native,prepareLegacyAssignment);
  const dispatch=nativeComputerFetch(send,native,"https://example.test","/agent",admit);
  const result=dispatch("https://example.test/agent/rpc/threads/send",{method:"POST",body:JSON.stringify({json:{botId:"new-bot",text:"original draft"}})});
  if(run.allowed){await result;expect(order).toEqual(["assigned","connected","message"]);}
  else {await expect(result).rejects.toThrow();expect(order).toEqual([]);expect(native.connect).not.toHaveBeenCalled();}
});

it.each(["team", "dedicated"])("sends a modern first reply without changing saved %s assignment", async computerMode => {
  const order: string[] = [];
  const draft = JSON.stringify({json:{botId:"new-bot",text:"original draft"}});
  const send = vi.fn<typeof fetch>(async (input, init) => {
    expect(new Headers(init?.headers).get("x-rakazo-space-id")).toBe("owned-space");
    if (String(input).endsWith("/bots/get")) {
      order.push("prepared");
      return Response.json({json:{id:"new-bot",computerMode,instructions:NATIVE_PROJECT_INSTRUCTIONS}});
    }
    expect(String(input)).toBe("https://example.test/agent/rpc/threads/send");
    expect(init?.body).toBe(draft);
    order.push("message");
    return Response.json({ok:true});
  });
  const native = {
    projectAvailable:vi.fn(async()=>true), requestAccess:vi.fn(async()=>true),
    revokeAccess:vi.fn(async()=>{}), onConfigure:vi.fn(()=>()=>{}),
    connected:vi.fn(async()=>true), connect:vi.fn(async()=>{order.push("connected");}),
  };
  const admit = nativeComputerAdmission(native, id => prepareNativeWorkspace(send,"https://example.test","/agent","owned-space",id));
  const dispatch = nativeComputerFetch(send,native,"https://example.test","/agent",admit);
  await dispatch("https://example.test/agent/rpc/threads/send",{
    method:"POST",headers:{"x-rakazo-space-id":"owned-space"},body:draft,
  });
  expect(order).toEqual(["prepared","connected","message"]);
  expect(send).toHaveBeenCalledTimes(2);
});

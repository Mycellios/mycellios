// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InboxTask } from "@mycellios/contracts";
import type { RpcClient } from "../../lib/rpc";
vi.mock("@lingui/react/macro",()=>({useLingui:()=>({t:(s:TemplateStringsArray,...v:unknown[])=>String.raw(s,...v)})}));
import { TaskFollowUp } from "./TaskFollowUp";
let root:Root,host:HTMLDivElement;
const followUp=vi.fn(),changed=vi.fn();
const client={taskInbox:{followUp}} as unknown as RpcClient;
const item={id:"kuma",pinned:false,remindAt:null,archivedAt:null} as InboxTask;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.clearAllMocks();followUp.mockResolvedValue({ok:true});host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function render(row=item){await act(()=>root.render(<TaskFollowUp item={row} client={client} onChanged={changed}/>));}
async function click(text:string){const button=[...host.querySelectorAll('button')].find(button=>button.textContent?.trim()===text)!;expect(button).toBeTruthy();await act(()=>button.click());}
it("pins only this conversation without replacing an existing reminder",async()=>{
 await render({...item,remindAt:new Date(Date.now()+60000).toISOString()});
 await click("Pin conversation");expect(followUp).toHaveBeenCalledWith({id:"kuma",pinned:true});expect(changed).toHaveBeenCalledOnce();
});
it("schedules a quick reminder and can dismiss a due reminder",async()=>{
 await render();await click("Remind me");const before=Date.now();await click("In 10 minutes");
 const request=followUp.mock.calls[0]![0];expect(request.id).toBe("kuma");expect(Date.parse(request.remindAt)).toBeGreaterThanOrEqual(before+600000);
 await render({...item,remindAt:new Date(Date.now()-1000).toISOString()});
 await act(()=>host.querySelector<HTMLButtonElement>('button[aria-label="Dismiss reminder"]')!.click());
 expect(followUp).toHaveBeenLastCalledWith({id:"kuma",remindAt:null});
});
it("keeps the editor open and reports failed saves without claiming success",async()=>{
 await render();await click("Remind me");followUp.mockRejectedValue(new Error("Offline"));await click("In 1 hour");
 expect(host.querySelector('form')).toBeTruthy();expect(host.querySelector('[role=alert]')).toBeTruthy();expect(changed).not.toHaveBeenCalled();
});

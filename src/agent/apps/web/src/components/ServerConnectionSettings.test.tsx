// @vitest-environment jsdom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f=vi.hoisted(()=>({notificationScopes:[] as string[]}));
vi.mock("../pages/settings/NotificationsPanel",()=>({NotificationsPanel:({scope}:{scope:string})=>{f.notificationScopes.push(scope);return <div>Account notifications</div>;}}));
vi.mock("@lingui/react/macro",()=>({useLingui:()=>({t:(s:TemplateStringsArray)=>s.join("")})}));
vi.mock("@rakazo/ui-web",()=>({
 Dialog:({children}:{children:ReactNode})=><div>{children}</div>,DialogTitle:({children}:{children:ReactNode})=><h2>{children}</h2>,DialogContent:({children}:{children:ReactNode})=><div role="dialog">{children}</div>,
 Button:({children,type,disabled,onClick,"aria-label":label}:ComponentProps<"button">)=><button type={type} disabled={disabled} onClick={onClick} aria-label={label}>{children}</button>,Input:(p:ComponentProps<"input">)=><input {...p}/>
}));
import {ServerConnectionSettings} from "./ServerConnectionSettings";
const server={mode:"existing" as const,serverUrl:"https://a.test",name:"Team",color:"#476b5c"};
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
const save=vi.fn(),close=vi.fn(),manage=vi.fn();
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.clearAllMocks();f.notificationScopes=[];save.mockResolvedValue(undefined);manage.mockResolvedValue(undefined);host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const render=async(current=true)=>act(async()=>root.render(<ServerConnectionSettings server={server} current={current} userId="alice" canEdit onSave={save} onManage={manage} onClose={close}/>));
async function click(text:string){const button=[...host.querySelectorAll("button")].find(el=>el.textContent===text||el.getAttribute("aria-label")===text);expect(button).toBeTruthy();await act(async()=>button!.click());}
async function name(value:string){const input=host.querySelector<HTMLInputElement>('#server-display-name')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});}
async function submit(){await act(async()=>host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));}
it("keeps edits when changing sections and asks before discarding unsaved changes",async()=>{
 await render();await name("New team");await click("Connection");await click("General");expect(host.querySelector<HTMLInputElement>('#server-display-name')!.value).toBe("New team");
 await click("Close");expect(close).not.toHaveBeenCalled();expect(host.textContent).toContain("Discard unsaved connection changes?");await click("Keep editing");expect(close).not.toHaveBeenCalled();await click("Close");await click("Discard changes");expect(close).toHaveBeenCalledOnce();
});
it("saves trimmed names and closes only after confirmation",async()=>{
 await render();await name(" New team ");await submit();expect(save).toHaveBeenCalledWith({name:"New team",color:"#476b5c"});expect(close).toHaveBeenCalledOnce();
});
it("retains the draft after storage failure and offers a retry",async()=>{
 save.mockRejectedValueOnce(Error("quota"));await render();await name("New team");await submit();expect(close).not.toHaveBeenCalled();expect(host.querySelector('[role=alert]')?.textContent).toContain("Could not save");expect(host.querySelector<HTMLInputElement>('#server-display-name')!.value).toBe("New team");await submit();expect(close).toHaveBeenCalledOnce();
});
it("does not show the current account's notification settings for an inactive server",async()=>{
 await render(false);await click("Notifications");expect(f.notificationScopes).toEqual([]);expect(host.textContent).toContain("Connect to this server");await click("Connect");expect(manage).toHaveBeenCalledOnce();
});
it("uses only the authenticated account on the current server",async()=>{
 await render();await click("Notifications");expect(f.notificationScopes).toContain("alice");
});
it("does not start a second write or close while the first write is pending",async()=>{
 let resolve!:()=>void;save.mockReturnValue(new Promise<void>(r=>{resolve=r;}));await render();await name("New team");await submit();await submit();expect(save).toHaveBeenCalledOnce();expect(host.querySelector<HTMLButtonElement>('button[aria-label=Close]')?.disabled).toBe(true);await act(async()=>resolve());expect(close).toHaveBeenCalledOnce();
});

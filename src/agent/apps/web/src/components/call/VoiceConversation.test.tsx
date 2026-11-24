// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { RpcClient } from "../../lib/rpc";

const audio = vi.hoisted(() => ({ listen: vi.fn(), stop: vi.fn(), speak: vi.fn(), silence: vi.fn() }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (parts: TemplateStringsArray, ...values: unknown[]) => parts.reduce((text, part, index) => text + part + (values[index] ?? ""), ""), i18n: { locale: "es" } }) }));
vi.mock("@mycellios/ui-web", () => ({ BotAvatar: () => <span />, Button: ({ variant: _v, size: _s, ...props }: any) => <button {...props} /> }));
vi.mock("../../lib/dictation", () => ({ webSpeechAvailable: () => true, dictation: { listen: audio.listen, stop: audio.stop, subscribe: () => () => {} } }));
vi.mock("../../lib/tts", () => ({ browserSpeechAvailable: () => true, speaker: { speak: audio.speak, stop: audio.silence, subscribe: () => () => {} } }));
vi.mock("../../lib/call-session", () => ({ endCall: vi.fn() }));
import { VoiceConversation } from "./VoiceConversation";

let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("ignores a previous failed turn and reads only the new reply in the owned task chat", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const get = vi.fn().mockResolvedValue({ cursor: 3, messages: [] });
  const send = vi.fn(async (_input: unknown, _options?: unknown) => {
    get.mockResolvedValueOnce({
      cursor: 3, messages: [], run: { id: "old-run", taskId: "old-turn", status: "failed" },
    }).mockResolvedValue({
      cursor: 6, activeRuns: [],
      run: { id: "voice-run", taskId: "voice-turn", status: "completed" },
      messages: [
        { id: "unrelated", runId: "old-run", role: "bot", blocks: [{ kind: "text", text: "No leer." }] },
        { id: "reply", runId: "voice-run", role: "bot", blocks: [{ kind: "text", text: "Listo." }] },
      ],
    });
    return { taskId: "voice-turn", runId: "voice-run", seq: 4 };
  });
  const client = { threads: { get, send } } as unknown as RpcClient;
  const close = vi.fn(), host = document.createElement("div");
  root = createRoot(host);
  await act(async () => root!.render(<VoiceConversation rpc={client} spaceId="owned-space" taskThreadId="private-task" bot={{ id: "mico", name: "Mico", color: "#9B5CF6" }} onClose={close} onSettings={() => {}} transcribe />));
  expect(audio.listen).toHaveBeenCalledOnce();
  expect(audio.listen.mock.calls[0]![0]).toMatchObject({ spaceId: "owned-space" });
  const turn = audio.listen.mock.calls[0]![0] as { onFinal: (text: string) => void };
  await act(async () => { turn.onFinal("Hola"); });
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]![0]).toMatchObject({ botId: "mico", taskThreadId: "private-task", text: "Hola", clientNonce: expect.any(String) });
  expect(get.mock.calls.every(call => call[0].taskThreadId === "private-task")).toBe(true);
  await act(async () => {
    await vi.waitFor(() => expect(audio.speak).toHaveBeenCalledWith("Listo.", expect.objectContaining({ botId: "mico" })));
  });
  expect(audio.speak).toHaveBeenCalledOnce();
  expect(host.querySelector("[role=alert]")).toBeNull();
  await act(async () => root!.unmount()); root = undefined;
  expect(audio.stop).toHaveBeenCalledWith("cancel");
  expect(audio.silence).toHaveBeenCalled();
});

it("talks to a group and reads each member's answer in its own voice as it finishes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const chief = { botId: "chief", name: "Chief", color: "#3F9F78" }, sales = { botId: "sales", name: "Sales", color: "#9B5CF6" };
  const first = { id: "a", runId: "r1", botId: "chief", role: "bot", blocks: [{ kind: "text", text: "Reparto las tareas." }] };
  const second = { id: "b", runId: "r2", botId: "sales", role: "bot", blocks: [{ kind: "text", text: "Cerró un 12% por encima." }] };
  const get = vi.fn().mockResolvedValue({ cursor: 3, messages: [] });
  const send = vi.fn(async (_input: unknown) => {
    get.mockResolvedValueOnce({ cursor: 3, messages: [] })
      .mockResolvedValueOnce({ cursor: 6, run: null, messages: [first],
        activeRuns: [{ id: "r2", taskId: "t2", botId: "sales", status: "running" }] })
      .mockResolvedValue({ cursor: 8, run: null, activeRuns: [], messages: [first, second] });
    return { taskId: "t1", runId: "r1", runIds: ["r1", "r2"], seq: 4 };
  });
  const host = document.createElement("div");
  root = createRoot(host);
  await act(async () => root!.render(<VoiceConversation rpc={{ threads: { get, send } } as unknown as RpcClient} spaceId="owned-space"
    bot={{ id: "chief", name: "Chief", color: "#3F9F78" }} group={{ id: "team", name: "Project room", members: [chief, sales], leadBotId: "chief" }}
    onClose={() => {}} onSettings={() => {}} transcribe />));
  expect(host.querySelector("[data-testid=voice-panel-header]")?.textContent).toContain("Project room");
  expect(host.querySelector("[data-testid=voice-member]")?.textContent).toBe("Chief");
  expect(get.mock.calls[0]![0]).toEqual({ groupId: "team" });
  const turn = audio.listen.mock.calls[0]![0] as { onFinal: (text: string) => void };
  await act(async () => { turn.onFinal("Empezad por los números"); });
  expect(send.mock.calls[0]![0]).toEqual({ groupId: "team", text: "Empezad por los números", clientNonce: expect.any(String) });
  await act(async () => {
    await vi.waitFor(() => expect(audio.speak).toHaveBeenCalledTimes(2), { timeout: 3000 });
  });
  expect(audio.speak.mock.calls[0]).toEqual(["Reparto las tareas.", expect.objectContaining({ botId: "chief" })]);
  expect(audio.speak.mock.calls[1]).toEqual(["Cerró un 12% por encima.", expect.objectContaining({ botId: "sales" })]);
  expect(host.querySelector("[role=alert]")).toBeNull();
  // Opening, background capture while the group works, then listening for the next turn.
  await act(async () => { await vi.waitFor(() => expect(audio.listen).toHaveBeenCalledTimes(3)); });
  expect(send).toHaveBeenCalledOnce();
});

it("shows a microphone error and restarts capture without resending a message", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  audio.listen.mockRejectedValueOnce(new Error("Microphone denied"));
  const send = vi.fn();
  const client = { threads: { get: vi.fn().mockResolvedValue({ messages: [] }), send } } as unknown as RpcClient;
  const host = document.createElement("div");
  root = createRoot(host);
  await act(async () => root!.render(<VoiceConversation rpc={client} bot={{ id: "mico", name: "Mico", color: "#9B5CF6" }} onClose={() => {}} onSettings={() => {}} />));
  expect(host.querySelector("[role=alert]")?.textContent).toContain("Check its permission");
  const start = [...host.querySelectorAll("button")].find(button => button.textContent === "Start talking");
  expect(start).toBeDefined();
  await act(async () => start!.click());
  expect(host.querySelector("[role=alert]")).toBeNull();
  expect(audio.listen).toHaveBeenCalledTimes(2);
  expect(send).not.toHaveBeenCalled();
});

it("prepares local models once and never starts the microphone after the panel closes", async () => {
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
 let complete!: ()=>void;
 const prepare = vi.fn(()=>new Promise<void>(resolve=>{complete=resolve;}));
 const native={status:vi.fn(async()=>({ready:false,preparing:false,downloaded:0,total:200})),prepare,stop:vi.fn(async()=>{})};
 Object.defineProperty(window,"mycelliosDesktop",{configurable:true,value:{localVoice:native}});
 const get=vi.fn(); const host=document.createElement("div");root=createRoot(host);
 try {
  await act(async()=>root!.render(<VoiceConversation rpc={{threads:{get}} as unknown as RpcClient} bot={{id:"mico",name:"Mico",color:"#3F9F78"}} onClose={()=>{}} onSettings={()=>{}} />));
  const activate=[...host.querySelectorAll("button")].find(b=>b.textContent==="Activate local voice")!;
  await act(async()=>{activate.click();activate.click();}); expect(prepare).toHaveBeenCalledOnce();
  await act(async()=>root!.unmount());root=undefined;
  await act(async()=>complete()); expect(get).not.toHaveBeenCalled(); expect(audio.listen).not.toHaveBeenCalled();
  expect(native.stop).toHaveBeenCalled();
 } finally {delete window.mycelliosDesktop;}
});

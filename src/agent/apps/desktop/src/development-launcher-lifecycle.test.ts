import {EventEmitter} from "node:events";
import path from "node:path";
import type {IpcMainInvokeEvent} from "electron";
import {beforeEach,afterEach,expect,it,vi} from "vitest";
import {DevelopmentLauncher,developmentLogTail,developmentPhaseBudget} from "./development-launcher.js";
const mocks=vi.hoisted(()=>({spawn:vi.fn(),validate:vi.fn(),sourceValidate:vi.fn(),bind:vi.fn(),context:vi.fn(),ensure:vi.fn()}));
vi.mock("node:child_process",()=>({spawn:mocks.spawn}));
vi.mock("node:fs/promises",()=>({chmod:vi.fn(async()=>{}),copyFile:vi.fn(async()=>{}),cp:vi.fn(async()=>{}),mkdir:vi.fn(async()=>{}),readFile:vi.fn(),stat:async()=>({isFile:()=>true}),writeFile:vi.fn(async()=>{}),rename:vi.fn(async()=>{}),readdir:vi.fn(async()=>[])}));
vi.mock("./development-copy.js",()=>({DevelopmentCopy:class {ensure=mocks.ensure;}}));
const event={senderFrame:{url:"https://www.mycellios.com/agent/app/mico"}} as IpcMainInvokeEvent;
let child:EventEmitter & {stdout:EventEmitter;stderr:EventEmitter;connected:boolean;exitCode:number|null;signalCode:string|null;send:ReturnType<typeof vi.fn>;kill:ReturnType<typeof vi.fn>};
const launcher=()=>new DevelopmentLauncher({directory:path.resolve("fixture/dev"),node:path.resolve("fixture/node"),npmCandidates:[],seeds:async()=>[],context:mocks.context});
beforeEach(()=>{
  vi.clearAllMocks();mocks.validate.mockResolvedValue(undefined);mocks.sourceValidate.mockResolvedValue(undefined);mocks.bind.mockResolvedValue(undefined);
  mocks.context.mockResolvedValue({key:"server/account/space/mico",validate:mocks.validate,bind:mocks.bind});
  mocks.ensure.mockResolvedValue({root:path.resolve("fixture/source"),workspace:path.resolve("fixture/source/src/agent"),validate:mocks.sourceValidate});
  child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),stderr:new EventEmitter(),connected:true,exitCode:null,signalCode:null,send:vi.fn(),kill:vi.fn()});
  mocks.spawn.mockImplementation(()=>{queueMicrotask(()=>child.stdout.emit("data",Buffer.from('MYCELLIOS_DEV_READY {"id":"fixture"}\n')));return child;});
});
afterEach(()=>vi.unstubAllEnvs());
it("binds the admitted source before launch and never forwards supplier credentials",async()=>{
  vi.stubEnv("ANTSEED_API_KEY","private-fixture");
  const result=await launcher().open(event,"mico");expect(result.opened).toBe(true);
  expect(mocks.bind).toHaveBeenCalledWith(path.resolve("fixture/source"),mocks.sourceValidate);
  expect(mocks.bind.mock.invocationCallOrder[0]).toBeLessThan(mocks.spawn.mock.invocationCallOrder[0]!);
  const [node,args,options]=mocks.spawn.mock.calls[0]!;
  expect(path.isAbsolute(node)).toBe(true);expect(args).toEqual([path.resolve("fixture/source/src/agent/scripts/desktop-dev.mjs")]);
  expect(options.env.ANTSEED_API_KEY).toBeUndefined();expect(options.env.MYCELLIOS_DEV_PARENT_PID).toBe(String(process.pid));expect(options.stdio).toContain("ipc");
});
it("cannot create a copy or launch when account admission fails",async()=>{
  mocks.context.mockRejectedValue(Error("Wrong account"));await expect(launcher().open(event,"mico")).rejects.toThrow("Wrong account");
  expect(mocks.ensure).not.toHaveBeenCalled();expect(mocks.spawn).not.toHaveBeenCalled();
});
it("rechecks the account after preparation before binding",async()=>{
  mocks.validate.mockRejectedValueOnce(Error("Session changed"));await expect(launcher().open(event,"mico")).rejects.toThrow("Session changed");
  expect(mocks.bind).not.toHaveBeenCalled();expect(mocks.spawn).not.toHaveBeenCalled();
});
it("stops its own stack if the chat changes while the app opens",async()=>{
  let checks=0;mocks.validate.mockImplementation(async()=>{if(++checks===4)throw Error("Chat changed");});
  await expect(launcher().open(event,"mico")).rejects.toThrow("Chat changed");
  expect(child.send.mock.calls[0]?.[0]).toEqual({type:"mycellios-dev-stop"});
});
it("normal app shutdown stops only the child it owns",async()=>{
  const app=launcher();await app.open(event,"mico");app.dispose();expect(child.send.mock.calls[0]?.[0]).toEqual({type:"mycellios-dev-stop"});
});
it("runs an owner-chosen checkout in place, like a worktree dev command",async()=>{
  const checkout={root:path.resolve("fixture/checkout"),workspace:path.resolve("fixture/checkout/src/agent"),validate:mocks.sourceValidate};
  const result=await new DevelopmentLauncher({directory:path.resolve("fixture/dev"),node:path.resolve("fixture/node"),npmCandidates:[],seeds:async()=>[],checkout:async()=>checkout,context:mocks.context}).open(event,"mico");
  expect(result.opened).toBe(true);
  expect(mocks.ensure).not.toHaveBeenCalled();
  expect(mocks.bind).toHaveBeenCalledWith(checkout.root,mocks.sourceValidate);
  const [,args,options]=mocks.spawn.mock.calls[0]!;
  expect(args).toEqual([path.join(checkout.workspace,"scripts/desktop-dev.mjs")]);
  expect(options.cwd).toBe(checkout.workspace);
  expect(options.env.MYCELLIOS_DEV_HOME).toBeUndefined();
});
it("reports phases, lets the same chat join its launch and refuses another Mico",async()=>{
  mocks.spawn.mockImplementation(()=>child);
  const app=launcher();
  const first=app.open(event,"mico");
  await vi.waitFor(()=>expect(mocks.spawn).toHaveBeenCalled());
  child.stdout.emit("data",Buffer.from("MYCELLIOS_DEV_PHASE installing\n"));
  expect(await app.status()).toMatchObject({state:"preparing",phase:"installing"});
  const joined=app.open(event,"mico");
  mocks.context.mockResolvedValueOnce({key:"server/account/space/other",validate:mocks.validate,bind:mocks.bind});
  await expect(app.open({senderFrame:{url:"https://www.mycellios.com/agent/app/other"}} as IpcMainInvokeEvent,"other")).rejects.toThrow("another Mico");
  child.stdout.emit("data",Buffer.from('MYCELLIOS_DEV_READY {"id":"fixture"}\n'));
  await expect(first).resolves.toEqual({opened:true});await expect(joined).resolves.toEqual({opened:true});
  expect(mocks.spawn).toHaveBeenCalledTimes(1);expect((await app.status()).state).toBe("running");
});
it("gives a first install a longer budget than the quiet startup phases",()=>{
  expect(developmentPhaseBudget("installing")).toBeGreaterThan(developmentPhaseBudget("starting"));
  expect(developmentPhaseBudget("building")).toBeGreaterThan(developmentPhaseBudget("opening"));
});
it("stops a launch while it prepares without reporting a failure",async()=>{
  mocks.spawn.mockImplementation(()=>child);
  const app=launcher();
  const launch=app.open(event,"mico");
  await vi.waitFor(()=>expect(mocks.spawn).toHaveBeenCalled());
  child.stdout.emit("data",Buffer.from("MYCELLIOS_DEV_PHASE installing\nadded 3 packages\n"));
  child.send.mockImplementation((message:unknown)=>{if((message as {type:string}).type==="mycellios-dev-stop"){child.exitCode=0;child.emit("exit",0);}});
  await app.stop();
  await expect(launch).resolves.toEqual({opened:false,stopped:true});
  expect((await app.status()).logs).toBe("added 3 packages");
});
it("keeps only recent readable output for the log view",()=>{
  expect(developmentLogTail("\u001b[32mready\u001b[0m\r\nMYCELLIOS_DEV_PHASE starting\nnext\n")).toBe("ready\nnext");
  expect(developmentLogTail(Array.from({length:500},(_,index)=>String(index)).join("\n")).split("\n")).toHaveLength(200);
});

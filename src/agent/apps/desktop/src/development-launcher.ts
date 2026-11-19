import {spawn} from "node:child_process";
import {createHash,randomUUID} from "node:crypto";
import {chmod, copyFile, cp, mkdir, readdir, readFile, rename, stat, writeFile} from "node:fs/promises";
import path from "node:path";
import type {IpcMainInvokeEvent} from "electron";
import {DevelopmentCopy} from "./development-copy.js";

export function developmentChat(url: string, botId: unknown) {
  if(typeof botId!=="string" || !/^[a-zA-Z0-9_-]{1,256}$/.test(botId))throw Error("Invalid agent.");
  const route=new URL(url);
  const segments=route.pathname.split("/").filter(Boolean);
  if(segments.at(-1)!==botId || segments.at(-2)!=="app" || route.searchParams.has("task") || route.searchParams.has("project"))
    throw Error("Open this Mico's main chat first.");
  return botId;
}

export type DevelopmentPhase="preparing"|"installing"|"building"|"starting"|"opening";
const phases=new Set<DevelopmentPhase>(["preparing","installing","building","starting","opening"]);
/** A first launch installs the whole workspace; only quiet phases keep the short budget. */
export const developmentPhaseBudget=(phase:DevelopmentPhase)=>phase==="installing"||phase==="building"?2700000:600000;

type LaunchResult={opened:boolean;error?:string;stopped?:boolean};
type PendingLaunch={key:string;phase:DevelopmentPhase;startedAt:number;stopped:boolean;result:Promise<LaunchResult>};
type StackCommand={node:string;script:string;cwd:string;env:NodeJS.ProcessEnv};
export type DevelopmentStatus=
  {state:"preparing";phase:DevelopmentPhase;startedAt:number;logs:string}|
  {state:"running"|"stopped";logs:string};
const LOG_LINES=200;
/** The last lines of the stack output, without terminal colour codes or launcher markers. */
export function developmentLogTail(text:string) {
  return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g,"").split(/\r?\n/).filter(line=>!line.startsWith("MYCELLIOS_DEV_PHASE ")).slice(-LOG_LINES).join("\n").trim();
}

/** Main owns every path/command. The renderer can supply only the current Mico. */
export class DevelopmentLauncher {
  private pending?: PendingLaunch;
  private children=new Set<ReturnType<typeof spawn>>();
  /** The stack this launcher started, if it still owns one. */
  private owned?: ReturnType<typeof spawn>;
  /** How the last launch reached its stack, so status/stop also work for one it joined. */
  private command?: StackCommand;
  private logs="";
  private probe?: {at:number;running:Promise<boolean>};
  constructor(private options: {
    directory:string;
    node:string;
    npmCandidates:string[];
    seeds():Promise<string[]>;
    /** An owner-chosen git checkout that runs in place; null keeps the bundled copy. */
    checkout?():Promise<{root:string;workspace:string;validate():Promise<void>}|null>;
    context(event:IpcMainInvokeEvent,botId:string):Promise<{key:string;validate():Promise<void>;bind(root:string,validateSource:()=>Promise<void>):Promise<void>}>;
  }) {}
  dispose() {for(const child of this.children)if(child.connected)child.send({type:"mycellios-dev-stop"},()=>{});}
  async open(event:IpcMainInvokeEvent, value:unknown) {
    // Authorize every request, including attempts to join an in-flight launch.
    const botId=developmentChat(event.senderFrame?.url ?? "",value);
    const context=await this.options.context(event,botId);
    // A reopened chat joins its own launch instead of failing while it prepares.
    if(this.pending?.key===context.key)return this.pending.result;
    if(this.pending)throw Error("Mycellios Dev is already being prepared for another Mico.");
    const pending:PendingLaunch={key:context.key,phase:"preparing",startedAt:Date.now(),stopped:false,result:Promise.resolve({opened:false})};
    this.pending=pending;this.logs="";this.probe=undefined;
    pending.result=this.launch(context,pending)
      .catch((error:unknown):LaunchResult=>{if(pending.stopped)return {opened:false,stopped:true};throw error;})
      .finally(()=>{if(this.pending===pending)this.pending=undefined;this.probe=undefined;});
    return pending.result;
  }
  /** State and recent stack output for the owner's own window; no paths or account data. */
  async status():Promise<DevelopmentStatus> {
    const logs=developmentLogTail(this.logs);
    if(this.pending)return {state:"preparing",phase:this.pending.phase,startedAt:this.pending.startedAt,logs};
    return {state:await this.running()?"running":"stopped",logs};
  }
  /** Stops a preparing or running stack, including one another launch already owned. */
  async stop() {
    if(this.pending)this.pending.stopped=true;
    const owned=this.owned;
    if(owned && owned.exitCode===null && owned.connected) {
      await new Promise<void>(resolve=>{owned.once("exit",()=>resolve());owned.send({type:"mycellios-dev-stop"},()=>{});setTimeout(resolve,15000);});
    } else if(this.command) await this.run("stop");
    this.probe=undefined;
    return {stopped:true};
  }
  private running() {
    const owned=this.owned;
    if(owned && owned.exitCode===null && owned.signalCode===null)return Promise.resolve(true);
    if(!this.command)return Promise.resolve(false);
    // The registry probe starts a short Node process; reuse a recent answer.
    if(!this.probe || Date.now()-this.probe.at>4000)this.probe={at:Date.now(),running:this.run("status").then(code=>code===0)};
    return this.probe.running;
  }
  private run(action:"status"|"stop") {
    const command=this.command!;
    return new Promise<number|null>(resolve=>{
      const child=spawn(command.node,[command.script,action],{cwd:command.cwd,env:command.env,windowsHide:true,stdio:"ignore"});
      const timer=setTimeout(()=>{child.kill();resolve(null);},20000);
      child.once("error",()=>{clearTimeout(timer);resolve(null);});
      child.once("exit",code=>{clearTimeout(timer);resolve(code);});
    });
  }
  private async launch(context:{key:string;validate():Promise<void>;bind(root:string,validateSource:()=>Promise<void>):Promise<void>},pending:PendingLaunch):Promise<LaunchResult> {
    const progress=(phase:DevelopmentPhase)=>{pending.phase=phase;};
    const directory=path.join(this.options.directory,createHash("sha256").update(context.key).digest("hex"));
    const checkout=await this.options.checkout?.() ?? null;
    const source=checkout ?? await new DevelopmentCopy(directory,this.options.seeds,async()=>{}).ensure();
    await context.validate();
    const npm=path.join(directory,"npm");
    // Electron can unpack npm.asar here; standalone Node cannot read asar paths.
    if(!await stat(path.join(npm,"bin/npm-cli.js")).then(s=>s.isFile(),()=>false)) {
      let found=false;
      for(const candidate of this.options.npmCandidates) {
        try {
          if(JSON.parse(await readFile(path.join(candidate,"package.json"),"utf8")).name!=="npm")continue;
          const staging=path.join(directory,`npm-preparing-${randomUUID()}`);await mkdir(staging);
          // The archive root itself is a file. Copy its virtual children, not
          // npm.asar, so standalone Node receives real files on every platform.
          for(const entry of await readdir(candidate,{withFileTypes:true})) {
            const from=path.join(candidate,entry.name),to=path.join(staging,entry.name);
            if(entry.isDirectory())await cp(from,to,{recursive:true,force:false,errorOnExist:true});
            else if(entry.isFile())await writeFile(to,await readFile(from));
            else throw Error("Development npm contains an unexpected link.");
          }
          await rename(staging,npm);found=true;break;
        }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
      }
      if(!found)throw Error("This installation does not include the development npm tools.");
    }
    await source.validate();await context.validate();
    await context.bind(source.root,source.validate);
    await source.validate();await context.validate();
    const bin=path.join(directory,"bin");await mkdir(bin,{recursive:true});
    const node=path.join(bin,process.platform==="win32"?"node.exe":"node");
    const bundledNode=this.options.node.replace(/\.asar([\\/])/g,".asar.unpacked$1");
    if(!await stat(node).then(s=>s.isFile(),()=>false))await copyFile(bundledNode,node);
    if(process.platform!=="win32")await chmod(node,0o755);
    const npmShim=process.platform==="win32"?'@"%~dp0node.exe" "%~dp0..\\npm\\bin\\npm-cli.js" %*\r\n':
      '#!/bin/sh\nexec "$(dirname "$0")/node" "$(dirname "$0")/../npm/bin/npm-cli.js" "$@"\n';
    await writeFile(path.join(bin,process.platform==="win32"?"npm.cmd":"npm"),npmShim,{mode:0o755});
    const log=path.join(directory,"development.log");
    await mkdir(directory,{recursive:true});
    if(pending.stopped)return {opened:false,stopped:true};
    const script=path.join(source.workspace,"scripts/desktop-dev.mjs");
    const env:NodeJS.ProcessEnv={...Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USER|USERNAME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES(?:\(X86\))?|LANG|LANGUAGE|TZ|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|LC_.*)$/i.test(key))),
        PATH:bin+path.delimiter+(process.env.PATH??""),
        // A checkout shares the profile `npm run dev:desktop` uses there, so both reach the same instance.
        ...(checkout?{}:{MYCELLIOS_DEV_HOME:path.join(directory,"profiles")}),
        MYCELLIOS_DEV_NPM_CLI:path.join(npm,"bin/npm-cli.js"),MYCELLIOS_DEV_PARENT_PID:String(process.pid)};
    this.command={node,script,cwd:source.workspace,env};
    const child=spawn(node,[script],{cwd:source.workspace,windowsHide:true,stdio:["ignore","pipe","pipe","ipc"],env});
    this.children.add(child);this.owned=child;
    child.once("exit",()=>{this.children.delete(child);if(this.owned===child)this.owned=undefined;this.probe=undefined;});
    let buffer="";
    // Keep recording after startup so the owner can follow the running stack.
    const record=(chunk:Buffer)=>{
      this.logs=(this.logs+String(chunk)).slice(-64000);
      void writeFile(log,this.logs,{mode:0o600}).catch(()=>{});
    };
    child.stderr?.on("data",record);child.stdout?.on("data",record);
    child.on("error",error=>record(Buffer.from(error.message)));
    try {await new Promise<void>((resolve,reject)=>{
      // Each reported phase receives its own budget, so a long first install is
      // not killed (and restarted from scratch) by a startup-sized deadline.
      let timer:ReturnType<typeof setTimeout>|undefined,phase:DevelopmentPhase="preparing";
      const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>finish(Error("Mycellios Dev took too long to start. See development.log.")),developmentPhaseBudget(phase));};
      const finish=(error?:Error)=>{clearTimeout(timer);child.stdout?.off("data",data);child.off("error",failed);child.off("exit",exited);error?reject(error):resolve();};
      const failed=(error:Error)=>finish(error);
      const exited=(code:number|null)=>finish(Error(`Mycellios Dev could not start (exit ${code}). See development.log.`));
      const data=(chunk:Buffer)=>{
        buffer=(buffer+String(chunk)).slice(-8192);
        for(const match of buffer.matchAll(/MYCELLIOS_DEV_PHASE (\w+)\r?\n/g)) {
          const next=match[1] as DevelopmentPhase;
          if(phases.has(next)&&next!==phase){phase=next;progress(next);arm();}
        }
        buffer=buffer.replace(/[^]*MYCELLIOS_DEV_PHASE \w+\r?\n/,"");
        if(buffer.includes("MYCELLIOS_DEV_READY ")||buffer.includes("Mycellios Dev already running."))finish();
      };
      arm();
      child.stdout?.on("data",data);child.once("error",failed);child.once("exit",exited);
    });
    await context.validate();
    }catch(error){if(child.connected)child.send({type:"mycellios-dev-stop"},()=>{});throw error;}
    return {opened:true};
  }
}

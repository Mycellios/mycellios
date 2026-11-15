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

/** Main owns every path/command. The renderer can supply only the current Mico. */
export class DevelopmentLauncher {
  private pending?: Promise<{opened:boolean;error?:string}>;
  private children=new Set<ReturnType<typeof spawn>>();
  constructor(private options: {
    directory:string;
    node:string;
    npmCandidates:string[];
    seeds():Promise<string[]>;
    context(event:IpcMainInvokeEvent,botId:string):Promise<{key:string;validate():Promise<void>;bind(root:string,validateSource:()=>Promise<void>):Promise<void>}>;
  }) {}
  dispose() {for(const child of this.children)if(child.connected)child.send({type:"mycellios-dev-stop"},()=>{});}
  async open(event:IpcMainInvokeEvent, value:unknown) {
    // Authorize every request, including attempts to join an in-flight launch.
    const botId=developmentChat(event.senderFrame?.url ?? "",value);
    const context=await this.options.context(event,botId);
    if(this.pending)throw Error("Mycellios Dev is already being prepared.");
    this.pending=this.launch(context).finally(()=>{this.pending=undefined;});
    return this.pending;
  }
  private async launch(context:{key:string;validate():Promise<void>;bind(root:string,validateSource:()=>Promise<void>):Promise<void>}) {
    const directory=path.join(this.options.directory,createHash("sha256").update(context.key).digest("hex"));
    const copy=new DevelopmentCopy(directory,this.options.seeds,async()=>{});
    const source=await copy.ensure();
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
    const child=spawn(node,[path.join(source.workspace,"scripts/desktop-dev.mjs")],{
      cwd:source.workspace,windowsHide:true,stdio:["ignore","pipe","pipe","ipc"],
      env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USER|USERNAME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES(?:\(X86\))?|LANG|LANGUAGE|TZ|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|LC_.*)$/i.test(key))),
        PATH:bin+path.delimiter+(process.env.PATH??""),MYCELLIOS_DEV_HOME:path.join(directory,"profiles"),MYCELLIOS_DEV_NPM_CLI:path.join(npm,"bin/npm-cli.js"),MYCELLIOS_DEV_PARENT_PID:String(process.pid)},
    });
    this.children.add(child);child.once("exit",()=>this.children.delete(child));
    let diagnostics="",buffer="";
    const record=(chunk:Buffer)=>{
      diagnostics=(diagnostics+String(chunk)).slice(-64000);
      void writeFile(log,diagnostics,{mode:0o600}).catch(()=>{});
    };
    child.stderr?.on("data",record);child.stdout?.on("data",record);
    child.on("error",error=>record(Buffer.from(error.message)));
    try {await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>finish(Error("Mycellios Dev took too long to start. See development.log.")),600000);
      const finish=(error?:Error)=>{clearTimeout(timer);child.stdout?.off("data",data);child.off("error",failed);child.off("exit",exited);error?reject(error):resolve();};
      const failed=(error:Error)=>finish(error);
      const exited=(code:number|null)=>finish(Error(`Mycellios Dev could not start (exit ${code}). See development.log.`));
      const data=(chunk:Buffer)=>{
        buffer=(buffer+String(chunk)).slice(-8192);
        if(buffer.includes("MYCELLIOS_DEV_READY ")||buffer.includes("Mycellios Dev already running."))finish();
      };
      child.stdout?.on("data",data);child.once("error",failed);child.once("exit",exited);
    });
    await context.validate();
    }catch(error){if(child.connected)child.send({type:"mycellios-dev-stop"},()=>{});throw error;}
    return {opened:true};
  }
}

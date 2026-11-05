import { mkdtemp, realpath, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import type { AdapterContext, ProcessEvent } from "@rakazo/adapter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { startHostComputerServer } from "./host-computer-server.js";
import { HostComputerSandbox } from "./host-computer-sandbox.js";
import type { NativeCommandReceipt } from "./native-command-journal.js";

const token = "a1".repeat(32);
const roots: string[] = [];
const hosts: Awaited<ReturnType<typeof startHostComputerServer>>[] = [];
const context = (runId: string, signal = new AbortController().signal): AdapterContext => ({
  operationId: runId, traceId: runId, spaceId: "fixture", userId: "fixture", runId, signal,
});
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
async function hostAt(root?: string) {
  root ??= await realpath(await mkdtemp(path.join(tmpdir(), "mycellios-native-recovery-")));
  if (!roots.includes(root)) roots.push(root);
  const host = await startHostComputerServer({ root, token, hostname: "127.0.0.1" }); hosts.push(host);
  host.setEnabled(true);
  const client = new HostComputerSandbox(`http://127.0.0.1:${host.port}`, token);
  const computer = await client.provision({ botId: "synthetic-mico", homePath: "unused" }, context("setup"));
  return { root, host, client, computer };
}
async function collect(events: AsyncIterable<ProcessEvent>) { const result = []; for await (const event of events) result.push(event); return result; }
async function finished(client: HostComputerSandbox, computer: Awaited<ReturnType<typeof hostAt>>["computer"], id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const receipt = await client.commandStatus(computer, id, context("observer")) as NativeCommandReceipt | null;
    if (receipt?.exitCode !== null && receipt?.exitCode !== undefined) return receipt;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Native command did not settle within the bounded fixture deadline");
}
describe("real native process recovery", () => {
  it("keeps an uncertain receipt after a real native-host crash and never relaunches its command", async()=>{
    const root=await realpath(await mkdtemp(path.join(tmpdir(),"mycellios-host-crash-")));roots.push(root);
    const child=spawn(process.execPath,['--import','tsx',fileURLToPath(new URL('./fixtures/native-command-host.ts',import.meta.url)),root],{
      cwd:process.cwd(),env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:['ignore','pipe','pipe'],
    });
    child.stderr.resume();
    const exited=once(child,'exit');
    try{
      let output='';
      const port=await new Promise<number>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Synthetic host startup timed out')),10000);
        child.once('error',reject);
        child.stdout.on('data',(data:Buffer)=>{output+=data.toString();if(output.includes('\n')){clearTimeout(timer);resolve(JSON.parse(output.split('\n')[0]!).port);}});
      });
      const client=new HostComputerSandbox(`http://127.0.0.1:${port}`,token);
      const computer=await client.provision({botId:'synthetic-mico',homePath:'unused'},context('setup'));
      const marker=path.join(root,'crash-once.txt');
      const command={commandId:'crash-owned',argv:[process.execPath,'-e',
        "require('node:fs').appendFileSync(process.argv[1],'x');console.log('ready');setInterval(()=>{},1000)",marker],timeoutMs:20000};
      const iterator=client.execute(computer,command,context('crashed-run'))[Symbol.asyncIterator]();
      expect((await iterator.next()).value).toMatchObject({type:'stdout'});
      child.kill('SIGKILL');await exited;
      await iterator.return?.(undefined).catch(()=>undefined);
      const restarted=await hostAt(root);
      const receipt=await restarted.client.commandStatus(restarted.computer,command.commandId,context('inspect')) as NativeCommandReceipt;
      expect(receipt.state).toBe('unknown');expect(receipt.exitCode).toBeNull();
      await expect(collect(restarted.client.execute(restarted.computer,command,context('crashed-run')))).rejects.toThrow('outcome is unknown');
      expect(await readFile(marker,'utf8')).toBe('x');
    }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;}
  },30000);
  it("recovers a disconnected HTTP observer and a host restart without reexecuting the command", async () => {
    const fixture = await hostAt(); const { client, computer, host, root } = fixture;
    expect((await client.environment(computer, context("probe"))).durableCommands).toBe(true);
    const marker = path.join(host.workspace("synthetic-mico"), "once.txt");
    const command = { commandId: "native-run:once", argv: [process.execPath, "-e",
      "require('node:fs').appendFileSync(process.argv[1],'x');console.log('ready');setTimeout(()=>process.exit(9),600)", marker], timeoutMs: 10000 };
    const observer = new AbortController();
    const iterator = client.execute(computer, command, context("native-run", observer.signal))[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: "stdout", data: expect.stringContaining("ready") });
    observer.abort(); await iterator.return?.(undefined).catch(() => undefined);
    const workerAfterRestart = new HostComputerSandbox(`http://127.0.0.1:${host.port}`, token);
    expect((await finished(workerAfterRestart, computer, command.commandId)).exitCode).toBe(9);
    expect(await collect(workerAfterRestart.execute(computer, command, context("native-run"))))
      .toContainEqual({ type: "exit", code: 9 });
    expect(await readFile(marker, "utf8")).toBe("x");
    await host.close(); hosts.splice(hosts.indexOf(host), 1);
    const reopened = await hostAt(root);
    expect(await collect(reopened.client.execute(reopened.computer, command, context("native-run"))))
      .toContainEqual({ type: "exit", code: 9 });
    expect(await readFile(marker, "utf8")).toBe("x");
  }, 30000);
  it("records a real deadline and cancels only the exact owned run", async () => {
    const { client, computer } = await hostAt();
    const command = (id: string, ms: number) => ({ commandId: id,
      argv: [process.execPath, "-e", "console.log('ready');setInterval(()=>{},1000)"], timeoutMs: ms });
    const timed = await collect(client.execute(computer, command("deadline", 200), context("timed-run")));
    expect(timed).toContainEqual({ type: "exit", code: 124 });
    const first = client.execute(computer, command("owned", 10000), context("first"))[Symbol.asyncIterator]();
    const other = client.execute(computer, command("unrelated", 10000), context("other"))[Symbol.asyncIterator]();
    await Promise.all([first.next(), other.next()]);
    await client.cancelRunWork(computer, computer.id, "first", context("cancel"));
    expect((await client.commandStatus(computer, "owned", context("inspect")) as NativeCommandReceipt).exitCode).toBe(130);
    expect((await finished(client, computer, "owned")).exitCode).toBe(130);
    expect((await client.commandStatus(computer, "unrelated", context("inspect")) as NativeCommandReceipt).state).toBe("running");
    await client.cancelRunWork(computer, computer.id, "other", context("cancel-other"));
    await Promise.all([first.return?.(undefined), other.return?.(undefined)]);
  }, 30000);
  it("refuses command observation after native consent is revoked", async () => {
    const { client, computer, host } = await hostAt(); host.setEnabled(false);
    await expect(client.commandStatus(computer, undefined, context("refused"))).rejects.toThrow("permission was refused");
  });
});

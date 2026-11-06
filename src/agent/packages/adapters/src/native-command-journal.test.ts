import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ProcessEvent } from "@rakazo/adapter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeCommandJournal, replaceNativeReceipt } from "./native-command-journal.js";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "mycellios-command-journal-")); directories.push(directory);
  return { directory, journal: new NativeCommandJournal(directory) };
}
const base = () => ({ id: "owned-run:tool-1", runId: "owned-run", fingerprint: "fingerprint",
  signal: new AbortController().signal, secrets: [] as string[] });
async function collect(events: AsyncIterable<ProcessEvent>) { const result: ProcessEvent[] = []; for await (const event of events) result.push(event); return result; }
describe("durable native commands", () => {
  it("bounds verbose receipts while retaining the terminal diagnostic and relay response budget",async()=>{
    const {journal}=await fixture();
    const events=await collect(journal.execute({...base(),start:async function*(){
      for(let n=0;n<12;n++)yield {type:'stdout' as const,data:'x'.repeat(32000)};
      yield {type:'stdout' as const,data:'FINAL_DIAGNOSTIC'};yield {type:'exit' as const,code:1};
    }}));
    expect(events.filter(event=>event.type==='stdout').map(event=>event.data).join('')).toContain('FINAL_DIAGNOSTIC');
    expect(Buffer.byteLength(JSON.stringify(await journal.list()))).toBeLessThan(1024*1024);
    expect((await journal.read(base().id))?.outputTruncated).toBe(true);
  });
  it("reattaches after observation disconnect without launching again, then survives a new journal instance", async () => {
    const { directory, journal } = await fixture(); let starts = 0;
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const input = { ...base(), start: async function* () { starts++; yield { type: "stdout" as const, data: "ready" }; await gate; yield { type: "exit" as const, code: 7 }; } };
    const observer = new AbortController();
    const iterator = journal.execute({ ...input, signal: observer.signal })[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ type: "stdout", data: "ready" });
    observer.abort(); await iterator.return?.();
    expect((await journal.read(input.id))?.state).toBe("running");
    release(); await journal.settled();
    const recovered = new NativeCommandJournal(directory);
    expect(await collect(recovered.execute(input))).toContainEqual({ type: "exit", code: 7 });
    expect(starts).toBe(1);
  });
  it("does not treat a truncated stream as success, or replay it after a restart", async () => {
    const { directory, journal } = await fixture(); let starts = 0;
    const input = { ...base(), start: async function* () { starts++; yield { type: "stdout" as const, data: "partial" }; } };
    await expect(collect(journal.execute(input))).rejects.toThrow("outcome is unknown");
    await expect(collect(new NativeCommandJournal(directory).execute(input))).rejects.toThrow("outcome is unknown");
    expect(starts).toBe(1); expect((await journal.read(input.id))?.exitCode).toBeNull();
  });
  it("fences concurrent duplicate starts and conflicting command identities", async () => {
    const { journal } = await fixture(); let starts = 0;
    const input = { ...base(), start: async function* () { starts++; yield { type: "exit" as const, code: 0 }; } };
    await Promise.all([collect(journal.execute(input)), collect(journal.execute(input))]);
    expect(starts).toBe(1);
    await expect(collect(journal.execute({ ...input, fingerprint: "another-command" }))).rejects.toThrow("conflicts");
    await expect(collect(journal.execute({ ...input, runId: "another-run" }))).rejects.toThrow("conflicts");
  });
  it("redacts split credentials before persisting receipts", async () => {
    const { directory, journal } = await fixture();
    await collect(journal.execute({ ...base(), secrets: ["synthetic-secret"], start: async function* () {
      yield { type: "stdout" as const, data: "token=synthetic-" };
      yield { type: "stdout" as const, data: "secret" };
      yield { type: "exit" as const, code: 0 };
    } }));
    const text = await readFile(path.join(directory, (await readdir(directory)).find(name => name.endsWith(".json"))!), "utf8");
    expect(text).not.toContain("synthetic-secret"); expect(text).toContain("[redacted]");
  });
});

it("rechecks the terminal receipt when completion overtakes an observer's disk snapshot", async () => {
  const {journal}=await fixture();
  const read=journal.read.bind(journal);let raced=false,starts=0;
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  vi.spyOn(journal,"read").mockImplementation(async id=>{
    const snapshot=await read(id);
    if(snapshot && snapshot.exitCode===null && !raced){raced=true;release();await journal.settled();}
    return snapshot;
  });
  const result=await collect(journal.execute({...base(),start:async function*(){starts++;await gate;yield {type:"exit" as const,code:7};}}));
  expect(raced).toBe(true);expect(starts).toBe(1);
  expect(result).toContainEqual({type:"exit",code:7});
});

it("retries only transient Windows atomic receipt replacements with a bounded budget",async()=>{
  const transient=Object.assign(new Error("sharing"),{code:"EPERM"});
  const replace=vi.fn<(...args:Parameters<typeof import("node:fs/promises").rename>)=>Promise<void>>()
    .mockRejectedValueOnce(transient).mockResolvedValue(undefined),pause=vi.fn(async()=>{});
  await replaceNativeReceipt("owned.tmp","owned.json",replace,"win32",pause);
  expect(replace).toHaveBeenCalledTimes(2);expect(pause).toHaveBeenCalledWith(20);
  const blocked=vi.fn(async()=>{throw transient;});
  await expect(replaceNativeReceipt("owned.tmp","owned.json",blocked,"win32",pause)).rejects.toBe(transient);
  expect(blocked).toHaveBeenCalledTimes(6);
  const invalid=Object.assign(new Error("disk"),{code:"EIO"}),disk=vi.fn(async()=>{throw invalid;});
  await expect(replaceNativeReceipt("owned.tmp","owned.json",disk,"win32",pause)).rejects.toBe(invalid);
  expect(disk).toHaveBeenCalledOnce();
});

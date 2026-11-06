import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { ProcessEvent } from "@rakazo/adapter-kit";
import { redactShellStreams } from "./agent-environment.js";

const MAX_OUTPUT = 64 * 1024;
const TAIL_OUTPUT = 8 * 1024;
const MAX_ACTIVE = 64;
const SAFE_COMMAND_ERRORS = new Set([
  "Command identity conflicts with an existing execution; nothing was executed",
  "Another host reserved this command; inspect its receipt before retrying",
  "Too many active native commands; wait for current work to finish",
  "Native command receipt is missing; execution was not repeated",
  "Invalid native command receipt; inspect the existing work before retrying",
  "Command outcome is unknown after native host restart. Inspect command_status and existing effects; do not replay it",
]);
export function safeNativeCommandError(error: unknown): boolean {
  return error instanceof Error && SAFE_COMMAND_ERRORS.has(error.message);
}
export interface NativeCommandReceipt {
  version: 1;
  id: string;
  executionId?: string;
  runId: string;
  fingerprint: string;
  host: string;
  state: "starting" | "running" | "completed" | "failed" | "interrupted" | "unknown";
  startedAt: string;
  updatedAt: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutTail?: string;
  stderrTail?: string;
  outputTruncated?: boolean;
}
type Active = { done: Promise<void>; controller: AbortController; receipt: NativeCommandReceipt };

/** Retry only an atomic receipt replacement held briefly by Windows file sharing. */
export async function replaceNativeReceipt(temporary: string, target: string, replace = rename,
  platform: NodeJS.Platform = process.platform, pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; ; attempt++) {
    try { await replace(temporary, target); return; }
    catch (error) {
      if (platform !== "win32" || attempt >= 5 || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      await pause(20 * 2 ** attempt);
    }
  }
}

/** Native-only receipts. Reattaching observes an existing command; it never replays it. */
export class NativeCommandJournal {
  private readonly host = randomUUID();
  private readonly active = new Map<string, Active>();
  private readonly admissions = new Map<string, Promise<void>>();
  constructor(private readonly directory: string) {}
  get runningCount() { return this.active.size; }

  private file(id: string) {
    return path.join(this.directory, createHash("sha256").update(id).digest("hex") + ".json");
  }
  private async save(receipt: NativeCommandReceipt, exclusive = false) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = this.file(receipt.id);
    const value = JSON.stringify(receipt);
    if (exclusive) {
      await writeFile(file, value, { flag: "wx", mode: 0o600 });
      return;
    }
    const temporary = file + "." + randomUUID() + ".tmp";
    await writeFile(temporary, value, { flag: "wx", mode: 0o600 });
    await replaceNativeReceipt(temporary, file);
  }
  async read(id: string): Promise<NativeCommandReceipt | null> {
    try {
      const receipt = JSON.parse(await readFile(this.file(id), "utf8")) as NativeCommandReceipt;
      if (receipt.version !== 1 || receipt.id !== id || typeof receipt.runId !== "string" ||
          typeof receipt.fingerprint !== "string" || typeof receipt.stdout !== "string" ||
          typeof receipt.stderr !== "string" || !["starting", "running", "completed", "failed", "interrupted", "unknown"].includes(receipt.state))
        throw new Error("Invalid native command receipt; inspect the existing work before retrying");
      for(const stream of ['stdout','stderr'] as const)if(receipt[stream].length>MAX_OUTPUT){
        const tail=stream==='stdout'?'stdoutTail':'stderrTail';
        receipt[tail]=receipt[stream].slice(-TAIL_OUTPUT);receipt[stream]=receipt[stream].slice(0,MAX_OUTPUT);receipt.outputTruncated=true;
      }
      // The previous native process owned a Windows Job / Unix process tree. Its receipt
      // cannot prove a final exit after a crash. Never fabricate rc=0 or adopt a reused PID.
      if ((receipt.state === "starting" || receipt.state === "running") && (receipt.host !== this.host || !this.active.has(id)))
        return { ...receipt, state: "unknown", exitCode: null };
      return receipt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async list(): Promise<NativeCommandReceipt[]> {
    let names: string[];
    try { names = await readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const receipts: NativeCommandReceipt[] = [];
    for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      const value = JSON.parse(await readFile(path.join(this.directory, name), "utf8"));
      const receipt = await this.read(value.id);
      if (receipt) receipts.push(receipt);
    }
    const bounded:NativeCommandReceipt[]=[];let bytes=0;
    for(const receipt of receipts.sort((a,b)=>b.startedAt.localeCompare(a.startedAt))){
      const size=Buffer.byteLength(JSON.stringify(receipt));if(bytes+size>1024*1024||bounded.length===20)break;
      bounded.push(receipt);bytes+=size;
    }
    return bounded;
  }
  cancel(runId?: string) {
    for (const entry of this.active.values())
      if (!runId || entry.receipt.runId === runId) entry.controller.abort();
  }

  async *execute(input: {
    id: string; executionId?: string; runId: string; fingerprint: string; signal: AbortSignal; secrets: string[];
    start(signal: AbortSignal): AsyncIterable<ProcessEvent>;
  }): AsyncIterable<ProcessEvent> {
    if (input.signal.aborted) return;
    // Serialize in-process admission. Exclusive creation is also the fence between
    // separate native host instances using the same persistent workspace.
    const preceding = this.admissions.get(input.id) ?? Promise.resolve();
    let release!: () => void;
    const admitted = new Promise<void>(resolve => { release = resolve; });
    this.admissions.set(input.id, admitted);
    await preceding;
    try {
      const existing = await this.read(input.id);
      if (existing && (existing.fingerprint !== input.fingerprint || existing.runId !== input.runId))
        throw new Error("Command identity conflicts with an existing execution; nothing was executed");
      if (!existing) {
        if (this.active.size >= MAX_ACTIVE)
          throw new Error("Too many active native commands; wait for current work to finish");
        const now = new Date().toISOString();
        const receipt: NativeCommandReceipt = { version: 1, id: input.id, executionId: input.executionId, runId: input.runId,
          fingerprint: input.fingerprint, host: this.host, state: "starting", startedAt: now,
          updatedAt: now, exitCode: null, stdout: "", stderr: "" };
        try { await this.save(receipt, true); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          throw new Error("Another host reserved this command; inspect its receipt before retrying");
        }
        const controller = new AbortController();
        // Execution belongs to the native host, not its HTTP observer. Explicit Stop,
        // revocation and the command deadline still stop this exact owned process tree.
        const done = this.drive(receipt, input, controller.signal);
        this.active.set(input.id, { done, controller, receipt });
        void done.finally(() => this.active.delete(input.id)).catch(() => undefined);
      }
    } finally {
      release();
      if (this.admissions.get(input.id) === admitted) this.admissions.delete(input.id);
    }
    let stdout = 0, stderr = 0;
    while (!input.signal.aborted) {
      const receipt = await this.read(input.id);
      if (!receipt) throw new Error("Native command receipt is missing; execution was not repeated");
      if (receipt.stdout.length > stdout) yield { type: "stdout", data: receipt.stdout.slice(stdout) };
      if (receipt.stderr.length > stderr) yield { type: "stderr", data: receipt.stderr.slice(stderr) };
      stdout = receipt.stdout.length; stderr = receipt.stderr.length;
      if (receipt.exitCode !== null) {
        const completing = this.active.get(input.id);
        if (completing) { await completing.done; continue; }
        if(receipt.outputTruncated){
          if(receipt.stdoutTail)yield {type:'stdout',data:'\n[output truncated; retained tail]\n'+receipt.stdoutTail};
          if(receipt.stderrTail)yield {type:'stderr',data:'\n[output truncated; retained tail]\n'+receipt.stderrTail};
        }
        yield { type: "exit", code: receipt.exitCode }; return;
      }
      if (!this.active.has(input.id)) {
        // drive() may have persisted its terminal receipt after this observer read
        // the previous snapshot, then removed the active entry. Recheck once.
        const terminal = await this.read(input.id);
        if (terminal && terminal.exitCode !== null) continue;
        throw new Error("Command outcome is unknown after native host restart. Inspect command_status and existing effects; do not replay it");
      }
      await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); input.signal.removeEventListener("abort", finish); resolve(); };
        const timer = setTimeout(finish, 100);
        input.signal.addEventListener("abort", finish, { once: true });
        if (input.signal.aborted) finish();
      });
    }
  }
  async settled(runId?: string) {
    await Promise.allSettled([...this.active.values()]
      .filter(entry => !runId || entry.receipt.runId === runId).map(entry => entry.done));
  }
  private async drive(receipt: NativeCommandReceipt, input: {
    secrets: string[]; start(signal: AbortSignal): AsyncIterable<ProcessEvent>;
  }, signal: AbortSignal) {
    let stdout = "", stderr = "";
    const guard=Math.max(4096,...input.secrets.map(secret=>secret.length));
    try {
      receipt.state = "running";
      await this.save(receipt);
      for await (const event of input.start(signal)) {
        if (event.type === "stdout") stdout += event.data;
        if (event.type === "stderr") stderr += event.data;
        if (event.type === "exit") {
          receipt.exitCode = event.code;
          receipt.state = event.code === 0 ? "completed" : event.code === 130 ? "interrupted" : "failed";
        }
        const safe = redactShellStreams({ stdout, stderr }, input.secrets, { withholdPartial: receipt.exitCode === null });
        if(receipt.stdout.length<MAX_OUTPUT)receipt.stdout = safe.stdout.slice(0, MAX_OUTPUT);
        if(receipt.stderr.length<MAX_OUTPUT)receipt.stderr = safe.stderr.slice(0, MAX_OUTPUT);
        if(safe.stdout.length>MAX_OUTPUT||safe.stderr.length>MAX_OUTPUT)receipt.outputTruncated=true;
        receipt.stdoutTail=safe.stdout.slice(-TAIL_OUTPUT);receipt.stderrTail=safe.stderr.slice(-TAIL_OUTPUT);
        // Keep enough overlap to redact a known secret spanning stream chunks. The
        // final tail is cut only after redaction, never from an unredacted fragment.
        if (stdout.length > MAX_OUTPUT * 2+guard) stdout = stdout.slice(-MAX_OUTPUT*2-guard);
        if (stderr.length > MAX_OUTPUT * 2+guard) stderr = stderr.slice(-MAX_OUTPUT*2-guard);
        receipt.updatedAt = new Date().toISOString();
        await this.save(receipt);
      }
      if (receipt.exitCode === null) receipt.state = "unknown";
    } catch {
      // A failed observation/storage operation cannot certify what the OS executed.
      receipt.state = "unknown";
      receipt.exitCode = null;
    } finally {
      receipt.updatedAt = new Date().toISOString();
      await this.save(receipt);
    }
  }
}

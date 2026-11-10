import { windowsProcessTree, type NativeProcessTree } from "../../../packages/adapters/src/desktop-process-tree.js";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, rename, stat, unlink } from "node:fs/promises";
import type { LocalVoiceModelKind, LocalVoiceModelStatus, LocalVoiceStatus } from "@rakazo/contracts";
import { createRequire } from "node:module";
import { join, sep } from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import models from "./local-voice-models.json" with { type: "json" };

// Pinned public model manifests: Parakeet (CC-BY-4.0), Supertonic (OpenRAIL-M).
// Pins match OpenBot's speech-models manifest; inference uses sherpa-onnx (Apache-2.0).
const require = createRequire(import.meta.url);
const modelKinds = ["asr", "tts"] as const;

function modelState(kind: LocalVoiceModelKind) {
  return {
    ready: false,
    downloaded: 0,
    total: models[kind].reduce((sum, file) => sum + file.bytes, 0),
    nextCheck: 0,
    checking: undefined as Promise<void> | undefined,
    preparing: undefined as Promise<void> | undefined,
    error: undefined as string | undefined,
  };
}

export function requireVoiceModelKind(value: unknown): LocalVoiceModelKind {
  if (value === "asr" || value === "tts") return value;
  throw new Error("Invalid voice model");
}

async function verifiedModel(target: string, file: { bytes: number; sha256: string }) {
  try {
    if ((await stat(target)).size !== file.bytes) return false;
    const hash = createHash("sha256");
    for await (const bytes of createReadStream(target)) hash.update(bytes);
    return hash.digest("hex") === file.sha256;
  } catch { return false; }
}

export class LocalVoice {
  private readonly models = { asr: modelState("asr"), tts: modelState("tts") };
  private tree?: NativeProcessTree;
  private worker?: ChildProcess;
  private owner?: number;
  private busy = false;
  private removing = false;
  private stopping?: Promise<void>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  constructor(private directory: string, private nodeExecutable = process.execPath) {}
  private modelStatus(kind: LocalVoiceModelKind): LocalVoiceModelStatus {
    const { ready, preparing, downloaded, total, error } = this.models[kind];
    return { ready, preparing: Boolean(preparing), downloaded, total, error };
  }
  status(): LocalVoiceStatus {
    const asr = this.modelStatus("asr");
    const tts = this.modelStatus("tts");
    return {
      ready: asr.ready && tts.ready,
      preparing: asr.preparing || tts.preparing,
      downloaded: asr.downloaded + tts.downloaded,
      total: asr.total + tts.total,
      error: asr.error ?? tts.error,
      models: { asr, tts },
    };
  }
  async statusFromDisk() {
    await Promise.all(modelKinds.map(kind => this.checkStoredModel(kind)));
    return this.status();
  }
  private async checkStoredModel(kind: LocalVoiceModelKind) {
    const state = this.models[kind];
    if (state.checking) return state.checking;
    if (this.removing || state.ready || state.preparing || Date.now() < state.nextCheck) return;
    state.checking = (async () => {
      for (const file of models[kind]) {
        if (!(await verifiedModel(join(this.directory, kind, file.name), file))) return;
      }
      state.downloaded = state.total;
      state.ready = true;
    })().finally(() => {
      state.checking = undefined;
      state.nextCheck = Date.now() + 30_000;
    });
    return state.checking;
  }
  async prepare() {
    for (const kind of modelKinds) await this.prepareModel(kind);
  }
  async prepareModel(kind: LocalVoiceModelKind) {
    const state = this.models[kind];
    if (this.removing) throw new Error("A local voice model is being removed");
    if (state.ready) return;
    if (state.preparing) return state.preparing;
    state.error = undefined;
    state.preparing = (async () => {
      await state.checking;
      if (!state.ready) await this.download(kind);
    })().catch((error) => {
      state.error = "Local voice preparation failed. Retry to resume verified files.";
      throw error;
    }).finally(() => { state.preparing = undefined; });
    return state.preparing;
  }
  private async download(kind: LocalVoiceModelKind) {
    const state = this.models[kind];
    state.downloaded = 0;
    await mkdir(join(this.directory, kind), { recursive: true });
    for (const file of models[kind]) {
      const completed = state.downloaded;
      const target = join(this.directory, kind, file.name);
      if (!(await verifiedModel(target, file))) {
        const temporary = target + `.partial-${process.pid}-${Date.now()}`;
        const response = await fetch(file.url, { signal: AbortSignal.timeout(600_000) });
        if (!response.ok || !response.body) throw new Error("Model download failed");
        let count = 0;
        const hash = createHash("sha256");
        const stream = Readable.fromWeb(response.body as never);
        stream.on("data", (bytes: Buffer) => {
          count += bytes.length;
          state.downloaded = completed + Math.min(count, file.bytes);
          if (count > file.bytes) stream.destroy(new Error("Model exceeds pinned size"));
          hash.update(bytes);
        });
        try {
          await pipeline(stream, createWriteStream(temporary));
          if (count !== file.bytes || hash.digest("hex") !== file.sha256) throw new Error("Model integrity failed");
          await rename(temporary, target);
        } catch (error) {
          await unlink(temporary).catch(() => {});
          throw error;
        }
      }
      state.downloaded = completed + file.bytes;
    }
    state.ready = true;
  }
  async removeModel(kind: LocalVoiceModelKind) {
    if (this.busy || this.removing || modelKinds.some(model => this.models[model].preparing)) {
      throw new Error("Wait for local voice to finish before removing a model");
    }
    this.removing = true;
    const state = this.models[kind];
    try {
      await state.checking;
      await this.stop();
      state.ready = false;
      state.downloaded = 0;
      state.nextCheck = 0;
      state.error = undefined;
      const modelDirectory = join(this.directory, kind);
      for (const directory of [this.directory, modelDirectory]) {
        const info = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        });
        if (!info) return;
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid model directory");
      }
      for (const file of models[kind]) {
        await unlink(join(modelDirectory, file.name)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    } finally {
      this.removing = false;
    }
  }
  async run(owner: number, input: { samples?: Float32Array; text?: string; language?: string; speed?: number }) {
    const kind = input.samples ? "asr" : "tts";
    if (!this.models[kind].ready || this.busy || this.removing || this.stopping) {
      throw new Error("Local voice is not ready or is busy");
    }
    if (input.samples && (!(input.samples instanceof Float32Array) || !input.samples.length || input.samples.length > 16000 * 60 ||
      !input.samples.every(Number.isFinite))) throw new Error("Invalid audio");
    if (!input.samples && (typeof input.text !== "string" || !input.text.trim() || input.text.length > 2000)) throw new Error("Invalid speech text");
    this.busy = true;
    this.owner = owner;
    clearTimeout(this.idleTimer);
    try {
      const unpacked = (file: string) => file.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);
      if (!this.worker?.connected) {
        this.worker = spawn(unpacked(this.nodeExecutable), ["-e", VOICE_WORKER], { windowsHide: true,
          serialization: "json", stdio: ["ignore", "ignore", "pipe", "ipc"],
          env: Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|LANG|LC_.*)$/i.test(key))),
        });
        this.worker.on("error", () => undefined);
        this.worker.stderr?.resume();
        if (process.platform === "win32") {
          if (!this.worker.pid) throw new Error("Voice process could not start");
          const tree = windowsProcessTree(this.worker.pid);
          this.tree = tree;
          this.worker.once("exit", () => tree.close());
        }
      }
      const worker = this.worker;
      return await new Promise<{ text?: string; samples?: Float32Array; sampleRate?: number }>((resolve, reject) => {
        const clean = () => { clearTimeout(timer); worker.off("message", message); worker.off("error", fail); worker.off("exit", exited); };
        const fail = (error: Error) => { clean(); reject(error); };
        const exited = () => fail(new Error("Voice stopped"));
        const message = (result: {error?: boolean; detail?: string; text?: string; pcm?: string; sampleRate?: number}) => {
          clean(); result.error ? reject(new Error("Local voice inference failed", {cause:new Error(result.detail ?? "Unknown native failure")})) : (() => {
            if (result.pcm) {
              const bytes = Buffer.from(result.pcm, "base64");
              if (bytes.length > 48_000 * 180 * 4 || bytes.length % 4 || !result.sampleRate || result.sampleRate < 8000 || result.sampleRate > 48000) return reject(new Error("Invalid native audio"));
              resolve({samples:new Float32Array(new Uint8Array(bytes).buffer),sampleRate:result.sampleRate});
            } else resolve({text:result.text});
          })();
        };
        const timer = setTimeout(() => { this.tree?.kill(); worker.kill(); fail(new Error("Voice timed out")); }, 120_000);
        worker.once("message", message); worker.once("error", fail); worker.once("exit", exited);
        worker.send({directory:this.directory,runtime:unpacked(require.resolve("sherpa-onnx-node")),input:{...input,samples:input.samples ? Buffer.from(input.samples.buffer,input.samples.byteOffset,input.samples.byteLength).toString("base64") : undefined}}, error => { if(error) fail(error); });
      });
    } catch (error) {
      await this.stop(); throw error;
    } finally {
      this.busy = false;
      this.idleTimer = setTimeout(() => { if(!this.busy) void this.stop(); },60_000);
      this.idleTimer.unref();
    }
  }
  async stop(owner?: number) {
    if (owner !== undefined && owner !== this.owner) return;
    if (this.stopping) return this.stopping;
    this.stopping = this.stopWorker().finally(() => { this.stopping = undefined; });
    return this.stopping;
  }
  private async stopWorker() {
    clearTimeout(this.idleTimer);
    const tree = this.tree; this.tree = undefined;
    tree?.kill();
    const host=this.worker; this.worker=undefined;
    if (!host || host.exitCode !== null) { tree?.close(); return; }
    await new Promise<void>(resolve => {
      const timer=setTimeout(resolve,2000); timer.unref();
      host.once("exit",()=>{clearTimeout(timer);resolve();}); host.kill();
    });
    tree?.close();
  }

}

const VOICE_WORKER = `
let asr,tts;process.on('disconnect',()=>process.exit());process.on('message',(d)=>{const p={postMessage:r=>process.send(r)};
const {join}=require('node:path'); const s=require(d.runtime); const f=(k,n)=>join(d.directory,k,n);
try {
 if(d.input.samples){
  const r=asr??=new s.OfflineRecognizer({featConfig:{sampleRate:16000,featureDim:80},modelConfig:{
   transducer:{encoder:f('asr','encoder.int8.onnx'),decoder:f('asr','decoder.int8.onnx'),joiner:f('asr','joiner.int8.onnx')},
   tokens:f('asr','tokens.txt'),numThreads:2,provider:'cpu',modelType:'nemo_transducer'}});
  const bytes=Buffer.from(d.input.samples,'base64');const samples=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
  const stream=r.createStream(); stream.acceptWaveform({sampleRate:16000,samples});r.decode(stream);p.postMessage({text:r.getResult(stream).text});
 }else{
  const t=tts??=new s.OfflineTts({model:{supertonic:{durationPredictor:f('tts','duration_predictor.int8.onnx'),textEncoder:f('tts','text_encoder.int8.onnx'),
   vectorEstimator:f('tts','vector_estimator.int8.onnx'),vocoder:f('tts','vocoder.int8.onnx'),ttsJson:f('tts','tts.json'),unicodeIndexer:f('tts','unicode_indexer.bin'),voiceStyle:f('tts','voice.bin')},numThreads:2,provider:'cpu'},maxNumSentences:1});
  const a=t.generate({text:d.input.text,generationConfig:new s.GenerationConfig({sid:0,speed:Math.max(.5,Math.min(2,d.input.speed||1)),numSteps:8,extra:{lang:d.input.language||'es'}})});
  p.postMessage({pcm:Buffer.from(a.samples.buffer,a.samples.byteOffset,a.samples.byteLength).toString('base64'),sampleRate:a.sampleRate});
 }
}catch(e){p.postMessage({error:true,detail:String(e.message).slice(0,500)});}
});
`;

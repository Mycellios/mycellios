import { windowsProcessTree, type NativeProcessTree } from "../../../packages/adapters/src/desktop-process-tree.js";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
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
export class LocalVoice {
  private downloadAbort?: AbortController;
  private tree?: NativeProcessTree;
  private preparing?: Promise<void>;
  private worker?: ChildProcess;
  private busy = false;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private ready = false;
  private downloaded = 0;
  private error?: string;
  constructor(private directory: string, private nodeExecutable = process.execPath) {}
  status() { return { ready: this.ready, preparing: Boolean(this.preparing), downloaded: this.downloaded,
    total: [...models.asr, ...models.tts].reduce((n, f) => n + f.bytes, 0), error: this.error }; }
  async prepare() {
    if (this.preparing) return this.preparing;
    this.error = undefined;
    this.downloadAbort = new AbortController();
    this.preparing = this.download().catch((error) => {
      this.error = "Local voice preparation failed. Retry to resume verified files.";
      throw error;
    }).finally(() => { this.preparing = undefined; });
    return this.preparing;
  }
  private async download() {
    this.downloaded = 0;
    for (const [kind, files] of Object.entries(models)) {
      await mkdir(join(this.directory, kind), { recursive: true });
      for (const file of files) {
        const completed = this.downloaded;
        const target = join(this.directory, kind, file.name);
        const valid = async () => {
          try {
            if ((await stat(target)).size !== file.bytes) return false;
            const hash = createHash("sha256");
            for await (const bytes of createReadStream(target)) hash.update(bytes);
            return hash.digest("hex") === file.sha256;
          } catch { return false; }
        };
        if (!(await valid())) {
          const temporary = target + `.partial-${process.pid}-${Date.now()}`;
          const response = await fetch(file.url, { signal: AbortSignal.any([AbortSignal.timeout(600_000), this.downloadAbort!.signal]) });
          if (!response.ok || !response.body) throw new Error("Model download failed");
          let count = 0;
          const hash = createHash("sha256");
          const stream = Readable.fromWeb(response.body as never);
          stream.on("data", (bytes: Buffer) => {
            count += bytes.length;
            this.downloaded = completed + count;
            if (count > file.bytes) stream.destroy(new Error("Model exceeds pinned size"));
            hash.update(bytes);
          });
          try {
            await pipeline(stream, createWriteStream(temporary));
            if (count !== file.bytes || hash.digest("hex") !== file.sha256) throw new Error("Model integrity failed");
            await rename(temporary, target);
          } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
        }
        this.downloaded = completed + file.bytes;
      }
    }
    this.ready = true;
  }
  async run(input: { samples?: Float32Array; text?: string; language?: string; speed?: number }) {
    if (!this.ready || this.busy) throw new Error("Local voice is not ready or is busy");
    if (input.samples && (!(input.samples instanceof Float32Array) || !input.samples.length || input.samples.length > 16000 * 60 ||
      !input.samples.every(Number.isFinite))) throw new Error("Invalid audio");
    if (!input.samples && (typeof input.text !== "string" || !input.text.trim() || input.text.length > 2000)) throw new Error("Invalid speech text");
    this.busy = true;
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
  async stop() {
    clearTimeout(this.idleTimer);
    this.downloadAbort?.abort();
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

// Local models on this PC (specs/local-models/spec.md): a pinned llama.cpp `llama-server`
// and pinned GGUF files, downloaded on request, verified by size and SHA-256, served only
// on loopback with a per-start key. Speed decides the default: the fastest model that
// still meets the floor, never the largest that fits.
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { totalmem } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  LocalModelFit, LocalModelInfo, LocalModelJobPhase, LocalModelSpeed, LocalModelsStatus,
} from "@mycellios/contracts";
import { windowsProcessTree, type NativeProcessTree } from "../../../packages/adapters/src/desktop-process-tree.js";

import manifest from "./local-models.json" with { type: "json" };

export type LocalModelSpec = (typeof manifest.models)[number];
type EngineTarget = { url: string; bytes: number; sha256: string; binary: string };
type Hardware = LocalModelsStatus["hardware"];
type Device = NonNullable<Hardware["gpu"]>;

/** The default model must write at least this fast on the PC (tokens per second). */
export const SPEED_FLOOR = 20;
const SLOW_FLOOR = 10;
const IDLE_UNLOAD_MS = 10 * 60_000;
const START_TIMEOUT_MS = 180_000;

export function engineTarget(platform = process.platform, arch = process.arch): EngineTarget | undefined {
  return (manifest.engine.targets as Record<string, EngineTarget>)[`${platform}-${arch}`];
}

export function localModelSpec(id: unknown): LocalModelSpec {
  const model = manifest.models.find((candidate) => candidate.id === id);
  if (!model) throw new Error("Unknown local model");
  return model;
}

/** Devices from `llama-server --list-devices`, e.g. `Vulkan0: AMD Radeon(TM) 890M Graphics (16444 MiB, 15622 MiB free)`. */
export function parseDevices(output: string): Device[] {
  const devices: Device[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(?:Vulkan|CUDA|MTL|Metal|ROCm|SYCL)\d*:\s*(.+?)\s*\((\d+)\s*MiB,\s*(\d+)\s*MiB free\)/.exec(line);
    if (!match) continue;
    const name = match[1]!;
    const kind = /apple/i.test(name) ? "apple"
      : /nvidia|geforce|rtx|gtx|quadro|radeon\s+(rx|pro)|\brx\s?\d|arc\s+a\d|arc\s+b\d/i.test(name) ? "discrete"
        : "integrated";
    devices.push({ name, memoryMiB: Number(match[2]), kind });
  }
  return devices;
}

export function hardwareProfile(devices: Device[], memoryBytes: number): Hardware {
  const memoryMiB = Math.round(memoryBytes / 1048576);
  const gpu = [...devices].sort((a, b) => b.memoryMiB - a.memoryMiB)[0];
  const tier = gpu?.kind === "discrete" && gpu.memoryMiB >= 7_500 ? "strong"
    : gpu && memoryMiB >= 15_000 ? "integrated"
      : "weak";
  return { ...(gpu ? { gpu } : {}), memoryMiB, tier };
}

/** Memory a model may use here: the discrete card's own memory, else a share of system memory. */
function memoryBudgetBytes(hardware: Hardware) {
  if (hardware.gpu?.kind === "discrete") return hardware.gpu.memoryMiB * 1048576 * 0.9;
  return hardware.memoryMiB * 1048576 * (hardware.gpu ? 0.6 : 0.5);
}

/**
 * Generation is bounded by memory bandwidth over the bytes read per token (active
 * parameters for mixture-of-experts models). The factors are calibrated on measured
 * runs (an integrated Radeon 890M wrote 22-28 t/s with a 1.3 GB model) and are replaced
 * by this PC's own measurement once a model has run.
 */
export function estimatedSpeed(model: LocalModelSpec, hardware: Hardware): LocalModelSpeed {
  const bandwidth = hardware.gpu?.kind === "discrete" ? 300 : hardware.gpu?.kind === "apple" ? 110 : hardware.gpu ? 95 : 60;
  const generation = (bandwidth * 0.34 * 1e9) / model.activeBytes;
  const prefill = generation * (hardware.gpu ? 12 : 6);
  return { prefill: Math.round(prefill), generation: Math.round(generation * 10) / 10, measured: false };
}

export function modelFit(model: LocalModelSpec, hardware: Hardware, speed: LocalModelSpeed): LocalModelFit {
  if (model.bytes * 1.2 > memoryBudgetBytes(hardware)) return "too-large";
  if (speed.generation >= SPEED_FLOOR) return "fast";
  return speed.generation >= SLOW_FLOOR ? "slower" : "very-slow";
}

/** Fast default: the largest model meeting the floor. Smarter: the largest that still runs acceptably. */
export function recommendModels(models: Pick<LocalModelInfo, "id" | "bytes" | "fit">[]) {
  const bySize = [...models].sort((a, b) => b.bytes - a.bytes);
  const recommended = bySize.find((model) => model.fit === "fast")?.id;
  const smarter = bySize.find((model) => model.fit === "slower" && model.id !== recommended)?.id;
  return { recommended, smarter };
}

async function verifiedFile(path: string, file: { bytes: number; sha256: string }) {
  try {
    if ((await stat(path)).size !== file.bytes) return false;
    const hash = createHash("sha256");
    for await (const bytes of createReadStream(path)) hash.update(bytes);
    return hash.digest("hex") === file.sha256;
  } catch { return false; }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => typeof address === "object" && address ? resolve(address.port) : reject(new Error("No free port")));
    });
  });
}

function systemTar() {
  return process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
}

function run(command: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {}) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: minimalEnv() });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk; });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk; });
    const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 60_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`${command} exited with ${code}`)); });
  });
}

function minimalEnv() {
  return Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|LANG|LC_.*|LD_LIBRARY_PATH|XDG_RUNTIME_DIR)$/i.test(key)));
}

export type LocalModelEndpoint = { modelId: string; baseUrl: string; apiKey: string; contextWindow: number };
type Loaded = LocalModelEndpoint & { process: ChildProcess; tree?: NativeProcessTree };
type Store = { speeds: Record<string, { prefill: number; generation: number; at: string }> };

export class LocalModels {
  private job?: { modelId: string; phase: LocalModelJobPhase; downloaded: number; total: number; error?: string; abort: AbortController };
  private working?: Promise<void>;
  private loaded?: Loaded;
  private loading?: Promise<LocalModelEndpoint>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private hardware?: Promise<Hardware>;
  private inspecting?: Promise<void>;
  private store?: Store;

  constructor(private readonly directory: string, private readonly fetcher: typeof fetch = fetch) {}

  private get engineDirectory() { return join(this.directory, "engine", manifest.engine.version); }
  private modelPath(model: LocalModelSpec) { return join(this.directory, "models", `${model.id}-${model.sha256.slice(0, 12)}.gguf`); }

  private async readStore(): Promise<Store> {
    if (this.store) return this.store;
    try {
      const parsed = JSON.parse(await readFile(join(this.directory, "state.json"), "utf8")) as Store;
      this.store = { speeds: typeof parsed?.speeds === "object" && parsed.speeds ? parsed.speeds : {} };
    } catch { this.store = { speeds: {} }; }
    return this.store;
  }

  private async saveSpeed(modelId: string, speed: { prefill: number; generation: number }) {
    const store = await this.readStore();
    store.speeds[modelId] = { ...speed, at: new Date().toISOString() };
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `state.json.${process.pid}.tmp`);
    await writeFile(temporary, JSON.stringify(store));
    await rename(temporary, join(this.directory, "state.json"));
  }

  private engineBinary() {
    const target = engineTarget();
    return target ? join(this.engineDirectory, target.binary) : undefined;
  }

  private async engineInstalled() {
    const binary = this.engineBinary();
    return Boolean(binary && await stat(binary).then((info) => info.isFile(), () => false));
  }

  /** The PC's devices, read once from the engine itself when it is installed. */
  private detectHardware(): Promise<Hardware> {
    this.hardware ??= (async () => {
      let devices: Device[] = [];
      if (await this.engineInstalled()) {
        devices = parseDevices(await run(this.engineBinary()!, ["--list-devices"], { cwd: this.engineDirectory, timeoutMs: 30_000 }).catch(() => ""));
      } else if (process.platform === "darwin" && process.arch === "arm64") {
        devices = [{ name: "Apple GPU", memoryMiB: Math.round(totalmem() / 1048576 * 0.7), kind: "apple" }];
      }
      return hardwareProfile(devices, totalmem());
    })().catch((error) => { this.hardware = undefined; throw error; });
    return this.hardware;
  }

  async status(): Promise<LocalModelsStatus> {
    const supported = Boolean(engineTarget());
    const hardware = await this.detectHardware();
    const store = await this.readStore();
    const models: LocalModelInfo[] = await Promise.all(manifest.models.map(async (model) => {
      const saved = store.speeds[model.id];
      const speed: LocalModelSpeed = saved ? { prefill: saved.prefill, generation: saved.generation, measured: true } : estimatedSpeed(model, hardware);
      return {
        id: model.id, name: model.name, publisher: model.publisher, license: model.license, source: model.source,
        bytes: model.bytes, contextWindow: model.contextWindow,
        installed: await stat(this.modelPath(model)).then((info) => info.size === model.bytes, () => false),
        fit: modelFit(model, hardware, speed), speed,
      };
    }));
    const { recommended, smarter } = supported ? recommendModels(models) : {};
    const job = this.job && { modelId: this.job.modelId, phase: this.job.phase, downloaded: this.job.downloaded, total: this.job.total, ...(this.job.error ? { error: this.job.error } : {}) };
    return {
      supported, inspected: await this.engineInstalled() || (process.platform === "darwin" && process.arch === "arm64"), hardware, models,
      ...(recommended ? { recommended } : {}), ...(smarter ? { smarter } : {}),
      ...(job ? { job } : {}), ...(this.loaded ? { loaded: this.loaded.modelId } : {}),
    };
  }

  /** Install only the engine so its device list replaces the guess. */
  inspect(): Promise<void> {
    if (!engineTarget()) return Promise.resolve();
    if (this.working) return this.working;
    this.inspecting ??= this.installEngine(AbortSignal.timeout(300_000)).finally(() => { this.inspecting = undefined; });
    return this.inspecting;
  }

  /** Download, verify, load and measure a model. One install at a time. */
  install(modelId: unknown): Promise<void> {
    const model = localModelSpec(modelId);
    if (!engineTarget()) return Promise.reject(new Error("Local models are not available on this PC"));
    if (this.working) {
      if (this.job?.modelId === model.id) return this.working;
      return Promise.reject(new Error("Another local model is being installed"));
    }
    const abort = new AbortController();
    this.job = { modelId: model.id, phase: "engine", downloaded: 0, total: model.bytes, abort };
    this.working = (async () => {
      await this.inspecting?.catch(() => undefined);
      await this.installEngine(abort.signal);
      this.setPhase("download", 0, model.bytes);
      await this.download(model.url, this.modelPath(model), model, abort.signal);
      this.setPhase("load", model.bytes, model.bytes);
      await this.endpoint(model.id);
      this.setPhase("measure", model.bytes, model.bytes);
      await this.measure(model.id);
      this.job = undefined;
    })().catch((error: unknown) => {
      if (this.job) this.job.error = abort.signal.aborted ? "Cancelled" : "The model could not be installed. Try again to resume the download.";
      throw error;
    }).finally(() => { this.working = undefined; });
    return this.working;
  }

  async cancel() {
    this.job?.abort.abort();
    await this.working?.catch(() => undefined);
    this.job = undefined;
  }

  async remove(modelId: unknown) {
    const model = localModelSpec(modelId);
    if (this.job?.modelId === model.id && this.working) throw new Error("Wait for the installation to finish");
    if (this.loaded?.modelId === model.id) await this.unload();
    await rm(this.modelPath(model), { force: true });
    const store = await this.readStore();
    if (store.speeds[model.id]) {
      delete store.speeds[model.id];
      await writeFile(join(this.directory, "state.json"), JSON.stringify(store));
    }
  }

  private setPhase(phase: LocalModelJobPhase, downloaded: number, total: number) {
    if (this.job) Object.assign(this.job, { phase, downloaded, total });
  }

  private async installEngine(signal: AbortSignal) {
    if (await this.engineInstalled()) return;
    const target = engineTarget()!;
    const root = join(this.directory, "engine");
    const archive = join(root, `${manifest.engine.version}${target.url.endsWith(".zip") ? ".zip" : ".tar.gz"}`);
    this.setPhase("engine", 0, target.bytes);
    await this.download(target.url, archive, target, signal);
    const staging = join(root, `${manifest.engine.version}.staging-${process.pid}`);
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    try {
      await run(systemTar(), ["-xf", archive, "-C", staging], { timeoutMs: 120_000 });
      const binary = join(staging, target.binary);
      if (!(await stat(binary).then((info) => info.isFile(), () => false))) throw new Error("Engine archive is missing llama-server");
      if (process.platform !== "win32") await chmod(binary, 0o755);
      await rm(this.engineDirectory, { recursive: true, force: true });
      await rename(staging, this.engineDirectory);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    } finally {
      await rm(archive, { force: true });
    }
    this.hardware = undefined;
  }

  /** Resumable download into `<target>.partial`, then size and SHA-256 checks before the rename. */
  private async download(url: string, target: string, file: { bytes: number; sha256: string }, signal: AbortSignal) {
    if (await verifiedFile(target, file)) { this.setPhase(this.job?.phase ?? "download", file.bytes, file.bytes); return; }
    await mkdir(join(target, ".."), { recursive: true });
    const partial = `${target}.partial`;
    let offset = await stat(partial).then((info) => info.size, () => 0);
    if (offset > file.bytes) { await rm(partial, { force: true }); offset = 0; }
    if (offset < file.bytes) {
      const response = await this.fetcher(url, { signal, headers: offset ? { range: `bytes=${offset}-` } : {} });
      if (!response.ok || !response.body) throw new Error("Download failed");
      if (response.status !== 206) offset = 0;
      let count = offset;
      if (this.job) this.job.downloaded = count;
      const stream = Readable.fromWeb(response.body as never);
      stream.on("data", (bytes: Buffer) => {
        count += bytes.length;
        if (this.job) this.job.downloaded = Math.min(count, file.bytes);
        if (count > file.bytes) stream.destroy(new Error("Download exceeds the pinned size"));
      });
      await pipeline(stream, createWriteStream(partial, { flags: offset ? "a" : "w" }), { signal });
    }
    if (this.job?.phase === "download") this.job.phase = "verify";
    if (!(await verifiedFile(partial, file))) {
      await rm(partial, { force: true });
      throw new Error("Downloaded file failed verification");
    }
    await rename(partial, target);
  }

  /** The loaded model's loopback endpoint, loading it (and unloading another) when needed. */
  async endpoint(modelId: string): Promise<LocalModelEndpoint> {
    const model = localModelSpec(modelId);
    this.touch();
    if (this.loaded?.modelId === model.id && this.loaded.process.exitCode === null) return this.loaded;
    if (this.loading) {
      const pending = await this.loading.catch(() => undefined);
      if (pending?.modelId === model.id) return pending;
    }
    this.loading = this.start(model).finally(() => { this.loading = undefined; });
    return this.loading;
  }

  private async start(model: LocalModelSpec): Promise<LocalModelEndpoint> {
    await this.unload();
    if (!(await this.engineInstalled())) throw new Error("The local model engine is not installed");
    const path = this.modelPath(model);
    if (!(await stat(path).then((info) => info.size === model.bytes, () => false))) throw new Error("This local model is not installed");
    const port = await freePort();
    const apiKey = randomBytes(24).toString("base64url");
    const keyFile = join(this.directory, `key-${process.pid}.txt`);
    await writeFile(keyFile, apiKey, { mode: 0o600 });
    const args = [
      "-m", path, "--host", "127.0.0.1", "--port", String(port), "--api-key-file", keyFile,
      "-ngl", "99", "-fa", "on", "-c", String(model.contextWindow), "-np", "1", "--jinja",
      "--reasoning", "off", "--no-webui", "--offline", "--cache-ram", "2048",
    ];
    const child = spawn(this.engineBinary()!, args, { cwd: this.engineDirectory, windowsHide: true, stdio: ["ignore", "ignore", "ignore"], env: minimalEnv() });
    let tree: NativeProcessTree | undefined;
    if (process.platform === "win32" && child.pid) tree = windowsProcessTree(child.pid);
    child.once("exit", () => {
      tree?.close();
      void rm(keyFile, { force: true });
      if (this.loaded?.process === child) this.loaded = undefined;
    });
    child.once("error", () => undefined);
    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error("The local model engine stopped while loading");
      const ready = await this.fetcher(`${baseUrl}/health`, { signal: AbortSignal.timeout(2_000) }).then((response) => response.ok, () => false);
      if (ready) {
        this.loaded = { modelId: model.id, baseUrl: `${baseUrl}/v1`, apiKey, contextWindow: model.contextWindow, process: child, ...(tree ? { tree } : {}) };
        return this.loaded;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    child.kill();
    throw new Error("The local model took too long to load");
  }

  /** Measure this PC's real speed with a short agent-like request and remember it. */
  private async measure(modelId: string) {
    const endpoint = await this.endpoint(modelId);
    const filler = "You help the person with files and the web. Keep answers short and check before changing anything. ";
    const ask = async (content: string, maxTokens: number) => {
      const response = await this.fetcher(`${endpoint.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${endpoint.apiKey}` },
        body: JSON.stringify({ messages: [{ role: "system", content }, { role: "user", content: "Explain in two sentences what a file is." }], max_tokens: maxTokens, temperature: 0, cache_prompt: false }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error("The local model did not answer");
      return (await response.json() as { timings?: { prompt_per_second?: number; predicted_per_second?: number } }).timings;
    };
    // The first request after loading also compiles GPU kernels; measuring it would
    // report a fraction of the real speed, so warm up first.
    await ask("Warm up.", 4);
    const timings = await ask(filler.repeat(24), 96);
    if (!timings?.predicted_per_second) return;
    await this.saveSpeed(modelId, { prefill: Math.round(timings.prompt_per_second ?? 0), generation: Math.round(timings.predicted_per_second * 10) / 10 });
  }

  private touch() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { void this.unload(); }, IDLE_UNLOAD_MS);
    this.idleTimer.unref?.();
  }

  async unload() {
    clearTimeout(this.idleTimer);
    const loaded = this.loaded;
    this.loaded = undefined;
    if (!loaded || loaded.process.exitCode !== null) return;
    const exited = new Promise((resolve) => loaded.process.once("exit", resolve));
    if (loaded.tree) loaded.tree.kill(); else loaded.process.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  }
}

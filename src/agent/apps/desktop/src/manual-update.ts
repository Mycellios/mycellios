import type { DesktopUpdateState } from "@rakazo/contracts";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { fetchDesktopArtifact } from "./published-desktop-release.js";

const ORIGIN = "https://www.mycellios.com";
const MAX_BYTES = 2_000_000_000;
const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
export type ManualRelease = { version: string; url: string; fileName: string; sha256: string; bytes: number };
export function newerRelease(candidate: string, current: string): boolean {
  if (!VERSION.test(candidate) || !VERSION.test(current)) return false;
  const a = candidate.split(".").map(Number), b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i]! > b[i]!; }
  return false;
}
export function windowsManualRelease(catalog: unknown, current: string): ManualRelease | null {
  if (!catalog || typeof catalog !== "object") throw Error("Invalid release catalog");
  const data = catalog as { packages?: unknown; automaticUpdates?: unknown };
  if (!Array.isArray(data.packages) || data.packages.length > 32) throw Error("Invalid release catalog");
  const packages = data.packages.filter(p => p && p.id === "windows-x64");
  if (packages.length !== 1) throw Error("Windows release is unavailable");
  const item = packages[0];
  if (typeof item.version !== "string" || !VERSION.test(item.version)) throw Error("Invalid release version");
  const fileName = `Mycellios-Desktop-${item.version}-windows-x64-pilot.exe`;
  if (item.fileName !== fileName || item.format !== "EXE" ||
      item.path !== `/downloads/desktop/releases/${item.version}/${fileName}` ||
      typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256) ||
      !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || item.bytes > MAX_BYTES)
    throw Error("Invalid Windows release artifact");
  return newerRelease(item.version, current) ? { version: item.version, fileName,
    url: ORIGIN + item.path, sha256: item.sha256, bytes: item.bytes } : null;
}
export async function verifyManualInstaller(file: string, release: ManualRelease): Promise<void> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== release.bytes) throw Error("Installer size differs");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest("hex") !== release.sha256) throw Error("Installer checksum differs");
}

/** Downloads may run in the background; installation always needs an explicit request. */
export class ManualUpdateController {
  private current: DesktopUpdateState;
  private release: ManualRelease | null = null;
  private file: string | null = null;
  private operation: Promise<DesktopUpdateState> | null = null;
  private intent = 0;
  private committed = false;
  private checkRequested = false;
  constructor(private readonly options: {
    version: string; directory(): string;
    fetch?: typeof fetch;
    busy(): boolean;
    prepare(): Promise<boolean>;
    handoff(file: string, release: ManualRelease): Promise<void>;
    pause?: (ms: number) => Promise<void>;
    backgroundDownloads?: boolean;
    publishedRelease?: () => Promise<ManualRelease | null>;
  }) {
    this.current = { phase: "idle", currentVersion: options.version, availableVersion: null,
      percent: null, message: null, checkedAt: null };
  }
  state() { return { ...this.current }; }
  private fail() { this.committed = false; this.current = { ...this.current, phase: this.file ? "ready" : "error",
    installPending: false, message: "Could not complete the update. Try again." }; }
  check(userInitiated: boolean): Promise<DesktopUpdateState> {
    if ((!userInitiated && !this.options.backgroundDownloads) || this.current.installPending || this.current.phase === "ready") return Promise.resolve(this.state());
    if (userInitiated) this.checkRequested = true;
    if (this.operation) return this.operation;
    this.operation = this.runCheck().finally(() => { this.operation = null; this.checkRequested = false; });
    return this.operation;
  }
  private async runCheck() {
    const previous = this.state();
    this.current = { ...this.current, phase: "checking", message: null };
    try {
      const feeds = [this.catalogRelease()];
      if (this.options.publishedRelease) feeds.push(Promise.resolve().then(() => this.options.publishedRelease!()));
      const results = await Promise.allSettled(feeds);
      const available = results.flatMap(r => r.status === "fulfilled" ? [r.value] : []);
      if (!available.length) throw Error("Release feeds unavailable");
      this.release = available.reduce<ManualRelease | null>((latest, r) =>
        r && newerRelease(r.version, latest?.version ?? this.options.version) ? r : latest, null);
      this.current = { ...this.current, phase: this.release ? "available" : "idle",
        availableVersion: this.release?.version ?? null, checkedAt: new Date().toISOString() };
      if (this.release) await this.runDownload();
      if (this.state().phase === "error" && !this.checkRequested) this.current = previous;
    } catch {
      if (this.checkRequested) this.fail();
      else this.current = previous;
    }
    return this.state();
  }
  private async catalogRelease(): Promise<ManualRelease | null> {
      const response = await (this.options.fetch ?? fetch)(ORIGIN + "/public/v1/desktop-downloads", {
        redirect: "error", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw Error("Catalog unavailable");
      if (!response.body) throw Error("Empty release catalog");
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let text = "", size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 64_000) throw Error("Catalog too large");
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { await reader.cancel().catch(() => undefined); }
      return windowsManualRelease(JSON.parse(text), this.options.version);
  }
  download(): Promise<DesktopUpdateState> {
    if (this.operation) return this.operation;
    this.operation = this.runDownload().then(() => this.state()).finally(() => { this.operation = null; });
    return this.operation;
  }
  private async runDownload() {
    const release = this.release;
    if (!release || this.file) return;
    const directory = this.options.directory();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = path.join(directory, release.fileName);
    try { await verifyManualInstaller(destination, release); this.file = destination; }
    catch {
      const temporary = destination + ".part";
      this.current = { ...this.current, phase: "downloading", percent: 0 };
      try {
        const response = await fetchDesktopArtifact(this.options.fetch ?? fetch, release.url, AbortSignal.timeout(15 * 60_000));
        if (!response.ok || !response.body) throw Error("Installer unavailable");
        let bytes = 0;
        const hash = createHash("sha256");
        const check = new Transform({ transform: (chunk: Buffer, _encoding, done) => {
          bytes += chunk.length;
          if (bytes > release.bytes) return done(Error("Installer exceeds catalog size"));
          hash.update(chunk);
          this.current = { ...this.current, percent: Math.floor(bytes / release.bytes * 100) };
          done(null, chunk);
        } });
        await pipeline(Readable.fromWeb(response.body as ReadableStream), check,
          createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
        if (bytes !== release.bytes || hash.digest("hex") !== release.sha256) throw Error("Installer differs from catalog");
        await rename(temporary, destination);
        this.file = destination;
      } catch { await rm(temporary, { force: true }); this.fail(); return; }
    }
    // Preserve Windows' normal downloaded-file checks; never remove its zone mark.
    if (process.platform === "win32") {
      try { await writeFile(destination + ":Zone.Identifier", `[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=${release.url}\r\n`, { mode: 0o600 }); }
      catch { this.file = null; this.fail(); return; }
    }
    this.current = { ...this.current, phase: "ready", percent: 100, message: null };
  }
  install(): Promise<DesktopUpdateState> {
    if (this.current.phase !== "ready" || this.current.installPending || !this.file || !this.release)
      return Promise.resolve(this.state());
    this.current = { ...this.current, installPending: true, message: "Waiting for local tasks and unsaved work…" };
    void this.finishInstall(++this.intent);
    return Promise.resolve(this.state());
  }
  cancelInstall(): Promise<DesktopUpdateState> {
    if (this.committed) return Promise.resolve(this.state());
    ++this.intent;
    this.current = { ...this.current, installPending: false, message: null };
    return Promise.resolve(this.state());
  }
  private async finishInstall(intent: number) {
    try {
      while (intent === this.intent) {
        // Waiting on an unsaved form must not reread a large installer every second.
        // The second acknowledgement below remains authoritative after hashing.
        if (!this.options.busy() && await this.options.prepare() && !this.options.busy()) {
          if (intent !== this.intent) return;
          try { await verifyManualInstaller(this.file!, this.release!); }
          catch (error) { this.file = null; throw error; }
          if (intent !== this.intent) return;
          if (!this.options.busy() && await this.options.prepare() && !this.options.busy()) {
            if (intent !== this.intent) return;
            this.committed = true;
            await this.options.handoff(this.file!, this.release!);
            return;
          }
        }
        await (this.options.pause ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(1_000);
      }
    } catch { if (intent === this.intent) this.fail(); }
  }
}

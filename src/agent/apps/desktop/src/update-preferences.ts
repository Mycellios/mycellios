import type { DesktopUpdatePreferences, DesktopUpdateState } from "@rakazo/contracts";

type Ports = {
  packaged: boolean; allowed: boolean;
  read(): Promise<string | null>; write(raw: string): Promise<void>;
  state(): DesktopUpdateState; download(): Promise<DesktopUpdateState>;
  install(): Promise<DesktopUpdateState>; cancelInstall(): Promise<DesktopUpdateState>;
  busy(): boolean; prepare(): Promise<boolean>; relaunch(): Promise<void>;
};

/** User-owned update choices. Every restart still requires a fresh idle and renderer check. */
export class UpdatePreferences {
  private value: DesktopUpdatePreferences;
  private writes = Promise.resolve();
  private working = false;
  private intent: "update" | "relaunch" | null = null;
  private revision = 0;
  private waiting: "local_work" | "unsaved_work" | "update_download" | undefined;
  private failed = false;
  private deferredVersion: string | null = null;
  constructor(private ports: Ports) {
    this.value = { channel: ports.packaged ? "stable" : "development", supported: ports.packaged && ports.allowed,
      autoDownload: true, autoInstall: false };
  }
  preferences() { return { ...this.value }; }
  state(): DesktopUpdateState {
    return { ...this.ports.state(), relaunchPending: this.intent !== null, relaunchWaitingFor: this.waiting,
      relaunchError: this.failed, autoInstallEnabled: this.value.supported && this.value.autoInstall };
  }
  async load() {
    try {
      const saved = JSON.parse(await this.ports.read() ?? "null");
      if (saved?.schema === 1) {
        if (typeof saved.autoDownload === "boolean") this.value.autoDownload = saved.autoDownload;
        if (typeof saved.autoInstall === "boolean") this.value.autoInstall = saved.autoInstall;
      }
    } catch { /* Preserve the installed package's safe defaults. */ }
  }
  save(patch: unknown): Promise<DesktopUpdatePreferences> {
    const run = this.writes.then(async () => {
      if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.entries(patch).some(([key, value]) =>
        !["autoDownload", "autoInstall"].includes(key) || typeof value !== "boolean")) throw new Error("Invalid update preference");
      if (!this.value.supported) throw new Error("Updates are managed by this installation");
      const next = { ...this.value, ...patch };
      await this.ports.write(JSON.stringify({ schema: 1, autoDownload: next.autoDownload, autoInstall: next.autoInstall }));
      this.value = next;
      if ("autoInstall" in patch) { this.deferredVersion = null; if (!next.autoInstall) await this.cancel(); }
      return this.preferences();
    });
    this.writes = run.then(() => undefined, () => undefined); return run;
  }
  request(kind: "update" | "relaunch") {
    if (kind === "update" && this.ports.state().phase !== "ready") return this.state();
    ++this.revision; this.intent = kind; this.waiting = "local_work"; this.failed = false;
    void this.tick(); return this.state();
  }
  async cancel() {
    ++this.revision; this.intent = null; this.waiting = undefined; this.failed = false;
    this.deferredVersion = this.ports.state().availableVersion;
    await this.ports.cancelInstall(); return this.state();
  }
  async tick() {
    if (this.working) return;
    this.working = true;
    try {
      let state = this.ports.state();
      if (this.value.supported && this.value.autoDownload && state.phase === "available") state = await this.ports.download();
      if (!this.intent && this.value.supported && this.value.autoInstall && state.phase === "ready" &&
          !state.installPending && state.availableVersion !== this.deferredVersion) {
        this.intent = "update"; ++this.revision;
      }
      if (!this.intent || state.installPending) return;
      if (state.phase === "checking" || state.phase === "downloading") { this.waiting = "update_download"; return; }
      const revision = this.revision, intent = this.intent;
      if (this.ports.busy()) { this.waiting = "local_work"; return; }
      this.waiting = "unsaved_work";
      if (!await this.ports.prepare() || revision !== this.revision || !this.intent) return;
      if (this.ports.busy()) { this.waiting = "local_work"; return; }
      if (intent === "update") {
        const result = await this.ports.install();
        if (result.message && !result.installPending) throw new Error("Update handoff failed");
      } else await this.ports.relaunch();
      if (revision === this.revision) { this.intent = null; this.waiting = undefined; }
    } catch {
      this.deferredVersion = this.ports.state().availableVersion;
      this.intent = null; this.waiting = undefined; this.failed = true;
    }
    finally { this.working = false; }
  }
}

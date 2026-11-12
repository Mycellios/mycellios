import type { DesktopUpdatePreferences, DesktopUpdateState } from "@rakazo/contracts";

type Ports = {
  packaged: boolean; allowed: boolean;
  read(): Promise<string | null>; write(raw: string): Promise<void>;
  state(): DesktopUpdateState; download(): Promise<DesktopUpdateState>;
  install(): Promise<DesktopUpdateState>; cancelInstall(): Promise<DesktopUpdateState>;
  busy(): boolean; prepare(): Promise<boolean>; relaunch(): Promise<void>;
  /** Package-manager installs are explicit only; unattended installation stays off. */
  installSupported?: boolean;
  autoInstallByDefault?: boolean;
  now?: () => number;
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
  private readonly installSupported: boolean;
  private automaticIntent = false;
  private automaticRestartAt: number | undefined;
  private automaticVersion: string | null = null;
  constructor(private ports: Ports) {
    this.installSupported = ports.installSupported !== false;
    this.value = { channel: ports.packaged ? "stable" : "development", supported: ports.packaged && ports.allowed,
      autoDownload: true, autoInstall: ports.packaged && ports.allowed && this.installSupported && ports.autoInstallByDefault === true };
  }
  preferences() { return { ...this.value, installSupported: this.installSupported }; }
  state(): DesktopUpdateState {
    return { ...this.ports.state(), relaunchPending: this.intent !== null, relaunchWaitingFor: this.waiting,
      relaunchError: this.failed, autoInstallEnabled: this.value.supported && this.installSupported && this.value.autoInstall,
      automaticRestartAt: this.automaticRestartAt };
  }
  async load() {
    try {
      const raw = await this.ports.read();
      const saved = raw === null ? null : JSON.parse(raw);
      if (raw !== null && (!saved || saved.schema !== 1 ||
          ["autoInstall", "autoDownload"].some(key => saved[key] !== undefined && typeof saved[key] !== "boolean")))
        throw new Error("Unreadable update preference");
      if (saved?.schema === 1) {
        if (typeof saved.autoDownload === "boolean") this.value.autoDownload = saved.autoDownload;
        if (typeof saved.autoInstall === "boolean") this.value.autoInstall = saved.autoInstall;
      }
    } catch { this.value.autoInstall = false; } // An unreadable opt-out must not turn into an automatic restart.
    if (!this.installSupported) this.value.autoInstall = false;
  }
  save(patch: unknown): Promise<DesktopUpdatePreferences> {
    const run = this.writes.then(async () => {
      if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.entries(patch).some(([key, value]) =>
        !["autoDownload", "autoInstall"].includes(key) || typeof value !== "boolean")) throw new Error("Invalid update preference");
      if (!this.value.supported) throw new Error("Updates are managed by this installation");
      const choice = patch as { autoInstall?: boolean };
      if (choice.autoInstall === true && !this.installSupported) throw new Error("This installation applies updates from the system installer");
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
    this.automaticIntent = false; this.automaticRestartAt = undefined;
    void this.tick(); return this.state();
  }
  async cancel() {
    ++this.revision; this.intent = null; this.waiting = undefined; this.failed = false;
    this.automaticIntent = false; this.automaticRestartAt = undefined;
    this.deferredVersion = this.ports.state().availableVersion;
    await this.ports.cancelInstall(); return this.state();
  }
  async tick() {
    if (this.working) return;
    this.working = true;
    try {
      let state = this.ports.state();
      if (this.value.supported && this.value.autoDownload && state.phase === "available") state = await this.ports.download();
      if (!this.intent && this.value.supported && this.installSupported && this.value.autoInstall && state.phase === "ready" &&
          !state.installPending && state.availableVersion !== this.deferredVersion) {
        this.intent = "update"; this.automaticIntent = true; ++this.revision;
      }
      if (!this.intent || state.installPending) return;
      if (state.phase === "checking" || state.phase === "downloading") { this.automaticRestartAt = undefined; this.waiting = "update_download"; return; }
      if (this.intent === "update" && state.phase !== "ready") {
        this.automaticRestartAt = undefined;
        if (state.phase === "error") throw new Error("Update is no longer ready");
        this.waiting = "update_download"; return;
      }
      const revision = this.revision, intent = this.intent;
      if (this.ports.busy()) { this.automaticRestartAt = undefined; this.waiting = "local_work"; return; }
      this.waiting = "unsaved_work";
      if (!await this.ports.prepare() || revision !== this.revision || !this.intent) { this.automaticRestartAt = undefined; return; }
      if (this.ports.busy()) { this.automaticRestartAt = undefined; this.waiting = "local_work"; return; }
      if (this.automaticIntent) {
        const latest = this.ports.state();
        if (latest.phase !== "ready" || latest.availableVersion !== state.availableVersion) { this.automaticRestartAt = undefined; return; }
        if (this.automaticVersion !== state.availableVersion) {
          this.automaticVersion = state.availableVersion; this.automaticRestartAt = undefined;
        }
        const now = (this.ports.now ?? Date.now)();
        this.automaticRestartAt ??= now + 15_000;
        this.waiting = undefined;
        if (now < this.automaticRestartAt) return;
      }
      if (intent === "update") {
        const result = await this.ports.install();
        if (result.message && !result.installPending && !result.handoffComplete) throw new Error("Update handoff failed");
      } else await this.ports.relaunch();
      if (revision === this.revision) { this.intent = null; this.waiting = undefined; this.automaticRestartAt = undefined; this.automaticIntent = false; }
    } catch {
      this.deferredVersion = this.ports.state().availableVersion;
      this.intent = null; this.waiting = undefined; this.failed = true; this.automaticRestartAt = undefined; this.automaticIntent = false;
    }
    finally { this.working = false; }
  }
}

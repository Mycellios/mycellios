import type { DesktopBehaviorSettings } from "@rakazo/contracts";

type Ports = {
  packaged: boolean; platform: string;
  read: () => Promise<string | null>; write: (raw: string) => Promise<void>;
  login: { get: () => boolean; set: (enabled: boolean) => void };
  power: { onBattery: () => boolean; start: () => number; stop: (id: number) => void };
  changed: (value: DesktopBehaviorSettings) => void;
};
const KEYS = new Set(["launchAtLogin", "keepRunningInBackground", "keepRemoteSessions", "keepAwake", "keepAwakeOnBattery", "externalLinkTarget"]);

/** Native-only effects, serialized writes and backwards-compatible profile migration. */
export class AppBehavior {
  private value: DesktopBehaviorSettings;
  private blocker: number | undefined;
  private queue = Promise.resolve();
  constructor(private ports: Ports) {
    this.value = { launchAtLogin: ports.packaged && ports.platform !== "linux" ? ports.login.get() : null,
      keepRunningInBackground: false, keepRemoteSessions: false, keepAwake: ports.platform === "linux" ? null : false,
      keepAwakeOnBattery: false, externalLinkTarget: "system" };
  }
  state() { return { ...this.value }; }
  async load() {
    const raw = await this.ports.read();
    try {
      const saved = JSON.parse(raw ?? "null");
      if (saved?.schema === 1 || saved?.schema === 2) {
        this.value.keepRunningInBackground = saved.keepRunningInBackground === true;
        this.value.keepRemoteSessions = saved.keepRemoteSessions === true;
        if (this.value.keepAwake !== null) this.value.keepAwake = saved.keepAwake === true;
        this.value.keepAwakeOnBattery = saved.keepAwakeOnBattery === true;
        if (saved.externalLinkTarget === "app") this.value.externalLinkTarget = "app";
      }
    } catch { /* Invalid profile uses safe defaults. */ }
    this.syncPower(); this.ports.changed(this.state());
  }
  update(patch: unknown): Promise<DesktopBehaviorSettings> {
    const run = this.queue.then(async () => {
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Invalid settings");
      for (const [key, value] of Object.entries(patch)) {
        if (!KEYS.has(key) || (key === "externalLinkTarget" ? value !== "app" && value !== "system" : typeof value !== "boolean")) throw new Error("Invalid setting");
        if (this.value[key as keyof DesktopBehaviorSettings] === null) throw new Error("Setting unavailable on this computer");
      }
      const previous = this.state();
      const next = { ...this.value, ...patch } as DesktopBehaviorSettings;
      if (next.launchAtLogin !== previous.launchAtLogin) {
        this.ports.login.set(next.launchAtLogin === true);
        if (this.ports.login.get() !== next.launchAtLogin) throw new Error("The operating system did not save startup settings");
      }
      try { await this.ports.write(JSON.stringify({ schema: 2, ...next })); }
      catch (error) {
        if (next.launchAtLogin !== previous.launchAtLogin) this.ports.login.set(previous.launchAtLogin === true);
        throw error;
      }
      this.value = next; this.syncPower(); this.ports.changed(this.state());
      return this.state();
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
  syncPower() {
    const awake = this.value.keepAwake === true && (this.value.keepAwakeOnBattery || !this.ports.power.onBattery());
    if (awake && this.blocker === undefined) this.blocker = this.ports.power.start();
    else if (!awake && this.blocker !== undefined) { this.ports.power.stop(this.blocker); this.blocker = undefined; }
  }
  dispose() { if (this.blocker !== undefined) { this.ports.power.stop(this.blocker); this.blocker = undefined; } }
}

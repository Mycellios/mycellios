import type { NativeEngineInstallable, NativeEngineUpdate, NativeInstallEngine } from "@mycellios/contracts";
import type { NativeEngineRelease, NativeEngineStoreOptions } from "./native-engine-store.js";
import {
  blocklistWithdraws, compareVersions, installNativeEngine, managedNativeEngine, nativeEngineBlocked, nativeEngineChannelRelease,
  NativeEngineInstallError, nativeEngineInstalling, nativeEngineRelease, nativeEngineTarget, nativeEngineVersions,
  readNativeEngineBlocklist, removeNativeEngineCopy, useNativeEngineBlocklist,
} from "./native-engine-store.js";

const ENGINES = ["codex", "claude", "opencode"] as const;
const NAMES: Record<NativeInstallEngine, string> = { codex: "Codex", claude: "Claude Code", opencode: "OpenCode" };
/** Desktop reads the channels and the blocklist when it starts and then once a day. */
const CHECK_INTERVAL_MS = 24 * 60 * 60_000;

/**
 * The status a native turn shows while its engine is updated on its PC, the way the PC's process
 * bound shows its waiting line. (The activity row reads some words as file or web work; this
 * sentence has none of them.)
 */
export function nativeEngineUpdateWaitText(engine: NativeInstallEngine) {
  return `Updating ${NAMES[engine]} on this PC. This turn starts once it is done.`;
}

/** What a native turn asks before it resolves its CLI: it waits while its engine updates, then counts as running. */
export interface NativeEngineUpdateGate {
  held(engine: NativeInstallEngine): boolean;
  /** Resolves, once no update holds the engine, with the call that ends the turn; rejects when the signal aborts first. */
  enter(engine: NativeInstallEngine, signal: AbortSignal): Promise<() => void>;
}

export type NativeEngineUpdateOptions = NativeEngineStoreOptions & {
  /** Tests only: a local stand-in for the blocklist main publishes. */
  blocklistUrl?: string;
};

type Hold = { count: number; done: Promise<void>; release: () => void };

/**
 * Keeps a PC's managed CLIs current (specs/native-engines/spec.md phase 3). At startup and once a day
 * it reads the blocklist published from main and, for each engine the store holds, the npm dist-tag
 * its lock names. It offers a newer version, which installs only once the person confirms it and is
 * verified exactly like a first install; a copy the list withdraws is replaced by the newest version
 * it does not withdraw. An update never replaces a CLI during a turn: every version has its own folder,
 * turns that started keep theirs, new turns of the engine wait while the candidate is checked and
 * started (for the whole replacement when a withdrawn copy leaves none to run), and a candidate that
 * fails is removed while the previous copy stays. Copies no turn needs go once that engine is idle.
 */
export class NativeEngineUpdates implements NativeEngineUpdateGate {
  /** The newest release each engine's channel named at the last check that reached the registry. */
  private readonly channel = new Map<NativeInstallEngine, NativeEngineRelease>();
  private readonly holds = new Map<NativeInstallEngine, Hold>();
  private readonly runs = new Map<NativeInstallEngine, number>();
  private readonly cleanups = new Map<NativeInstallEngine, Promise<void>>();
  private checking?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;

  constructor(readonly root: string, private readonly options: NativeEngineUpdateOptions = {}) {}

  /** Checks now and then once a day; the timer never keeps the app running. */
  start(intervalMs = CHECK_INTERVAL_MS) {
    if (this.timer) return;
    const check = () => { void this.check(); };
    check();
    this.timer = setInterval(check, intervalMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Reads the blocklist and the channels of the engines in the store, and replaces a copy the list
   * withdrew. A PC without managed CLIs sends nothing; a list that cannot be read blocks nothing new,
   * and a registry that cannot be read keeps the last offer.
   */
  check(): Promise<void> {
    this.checking ??= this.checkStore().catch(() => undefined).finally(() => { this.checking = undefined; });
    return this.checking;
  }

  held(engine: NativeInstallEngine) {
    return this.holds.has(engine);
  }

  async enter(engine: NativeInstallEngine, signal: AbortSignal): Promise<() => void> {
    for (let hold = this.holds.get(engine); hold; hold = this.holds.get(engine)) {
      const current = hold;
      await new Promise<void>((resolve, reject) => {
        const stop = () => reject(signal.reason instanceof Error ? signal.reason : new Error("The turn stopped while it waited"));
        if (signal.aborted) return stop();
        signal.addEventListener("abort", stop, { once: true });
        void current.done.then(() => {
          signal.removeEventListener("abort", stop);
          resolve();
        });
      });
    }
    signal.throwIfAborted();
    this.runs.set(engine, (this.runs.get(engine) ?? 0) + 1);
    let left = false;
    return () => {
      if (left) return;
      left = true;
      const running = (this.runs.get(engine) ?? 1) - 1;
      if (running > 0) this.runs.set(engine, running);
      else {
        this.runs.delete(engine);
        void this.cleanup(engine);
      }
    };
  }

  /** The release a first install brings: the lock's version, or the channel's newest when the list withdrew it. */
  installable(engine: NativeInstallEngine): NativeEngineInstallable | undefined {
    const release = this.firstRelease(engine);
    return release && { engine, version: release.version, source: "npm", package: release.package, bytes: release.bytes };
  }

  /** A first install the person confirmed. */
  async install(engine: NativeInstallEngine, authorize: () => void): Promise<void> {
    const release = this.firstRelease(engine);
    if (!release) throw new NativeEngineInstallError("Its maker publishes no version for this PC.");
    const list = await readNativeEngineBlocklist(this.options.fetch, this.options.blocklistUrl);
    if (list) useNativeEngineBlocklist(this.root, list);
    if (this.blocked(engine, release.version)) {
      const newest = await nativeEngineChannelRelease(engine, this.options).catch(() => null);
      if (newest) this.channel.set(engine, newest);
      throw new NativeEngineInstallError(`${NAMES[engine]} ${release.version} was withdrawn. Check the available version and try again.`);
    }
    authorize();
    void installNativeEngine(this.root, engine, { ...this.options, release })
      .catch(() => undefined)
      .finally(() => { void this.cleanup(engine); });
  }

  /**
   * Newer versions for the engines this PC runs from its store (`managed`: the version each one runs):
   * the channel's newest or a newer lock pin, never a withdrawn one, and none while an install runs.
   */
  offers(managed: Partial<Record<NativeInstallEngine, string>>): NativeEngineUpdate[] {
    return ENGINES.flatMap(engine => {
      const current = managed[engine];
      const release = current && !nativeEngineInstalling(this.root, engine) ? this.candidate(engine) : undefined;
      return current && release && compareVersions(release.version, current) > 0
        ? [{ engine, version: release.version, source: "npm" as const, package: release.package, bytes: release.bytes, current }]
        : [];
    });
  }

  /**
   * Starts the update the person confirmed: only to the version this PC offers, newer than the copy it
   * runs. The download goes on after this returns; its progress is reported with the installs.
   */
  async update(engine: NativeInstallEngine, version: string, authorize: () => void): Promise<void> {
    const release = this.candidate(engine);
    const usable = (await nativeEngineVersions(this.root, engine, this.options)).find(installed => !this.blocked(engine, installed));
    if (!release || release.version !== version || (usable && compareVersions(version, usable) <= 0))
      throw new NativeEngineInstallError("That version is no longer offered for this PC.");
    authorize();
    void this.replace(engine, release).catch(() => undefined);
  }

  private target() {
    return this.options.target ?? nativeEngineTarget();
  }

  private blocked(engine: NativeInstallEngine, version: string) {
    const target = this.target();
    return Boolean(target && nativeEngineBlocked(this.root, engine, version, target));
  }

  /** The newest release this PC may move an engine to: its channel's or its lock's, never a withdrawn one. */
  private candidate(engine: NativeInstallEngine) {
    return [this.channel.get(engine), nativeEngineRelease(engine, this.options)]
      .filter((release): release is NativeEngineRelease => release !== undefined && !this.blocked(engine, release.version))
      .sort((left, right) => compareVersions(right.version, left.version))[0];
  }

  private firstRelease(engine: NativeInstallEngine) {
    const pinned = nativeEngineRelease(engine, this.options);
    if (pinned && !this.blocked(engine, pinned.version)) return pinned;
    const newest = this.channel.get(engine);
    return newest && !this.blocked(engine, newest.version) ? newest : undefined;
  }

  /** New turns of an engine wait until every hold on it ends. */
  private hold(engine: NativeInstallEngine) {
    let hold = this.holds.get(engine);
    if (!hold) {
      let release!: () => void;
      const done = new Promise<void>(resolve => { release = resolve; });
      hold = { count: 0, done, release };
      this.holds.set(engine, hold);
    }
    const current = hold;
    current.count += 1;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      current.count -= 1;
      if (current.count > 0) return;
      if (this.holds.get(engine) === current) this.holds.delete(engine);
      current.release();
    };
  }

  /** Installs a newer release; new turns of the engine wait while it is checked and started. */
  private replace(engine: NativeInstallEngine, release: NativeEngineRelease, held?: () => void) {
    let end = held;
    return installNativeEngine(this.root, engine, { ...this.options, release, onChecking: () => { end ??= this.hold(engine); } })
      .finally(() => {
        end?.();
        void this.cleanup(engine);
      });
  }

  private async checkStore() {
    const target = this.target();
    if (!target) return;
    const installed = new Map<NativeInstallEngine, string[]>();
    for (const engine of ENGINES) installed.set(engine, await nativeEngineVersions(this.root, engine, this.options));
    if (![...installed.values()].some(versions => versions.length)) return;
    const list = await readNativeEngineBlocklist(this.options.fetch, this.options.blocklistUrl);
    // When the list withdraws every copy of an engine, its new turns wait from now on, before the list
    // applies, so none of them starts without a copy while the replacement downloads.
    const held = new Map<NativeInstallEngine, () => void>();
    if (list) {
      for (const [engine, versions] of installed)
        if (versions.length && versions.every(version => blocklistWithdraws(list, engine, version, target)))
          held.set(engine, this.hold(engine));
      useNativeEngineBlocklist(this.root, list);
    }
    try {
      for (const [engine, versions] of installed) {
        const pinned = nativeEngineRelease(engine, this.options);
        if (versions.length || (pinned && this.blocked(engine, pinned.version))) {
          // An unreachable registry keeps the last reading; nothing installs from it without verification.
          const newest = await nativeEngineChannelRelease(engine, this.options).catch(() => null);
          if (newest) this.channel.set(engine, newest);
          else if (newest === undefined) this.channel.delete(engine);
        }
        // The newest copy is the one turns ran: the list withdrew it, so the newest release it does
        // not withdraw replaces it, unless an older copy already is that release.
        if (versions[0] && this.blocked(engine, versions[0])) {
          const usable = versions.find(version => !this.blocked(engine, version));
          const replacement = this.candidate(engine);
          if (replacement && (!usable || compareVersions(replacement.version, usable) > 0))
            await this.replace(engine, replacement, held.get(engine)).catch(() => undefined);
        }
        held.get(engine)?.();
        await this.cleanup(engine);
      }
    } finally {
      for (const end of held.values()) end();
    }
  }

  private cleanup(engine: NativeInstallEngine): Promise<void> {
    const running = this.cleanups.get(engine);
    if (running) return running;
    const next = this.prune(engine).catch(() => undefined).finally(() => { this.cleanups.delete(engine); });
    this.cleanups.set(engine, next);
    return next;
  }

  /**
   * Removes copies no turn needs: withdrawn ones, and older ones once the copy turns start passed its
   * check in this session. Never while a turn of that engine runs or an install of it is under way, and
   * never anything outside the store (the person's own CLI, an operator's command).
   */
  private async prune(engine: NativeInstallEngine) {
    if (this.runs.get(engine) || nativeEngineInstalling(this.root, engine)) return;
    const versions = await nativeEngineVersions(this.root, engine, this.options);
    const usable = versions.filter(version => !this.blocked(engine, version));
    const active = usable.length > 1 ? await managedNativeEngine(this.root, engine, { ...this.options, waitMs: 0 }) : null;
    const superseded = active?.ready ? usable.filter(version => compareVersions(version, active.version) < 0) : [];
    for (const version of [...versions.filter(version => this.blocked(engine, version)), ...superseded]) {
      if (this.runs.get(engine) || nativeEngineInstalling(this.root, engine)) return;
      await removeNativeEngineCopy(this.root, engine, version);
    }
  }
}

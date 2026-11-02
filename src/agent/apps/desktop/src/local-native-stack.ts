import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import type { DesktopLocalStackState } from "@rakazo/contracts";
import {
  allocateLoopbackPort,
  initialStackState,
  STACK_TOKEN_FILE,
  STACK_WEB_URL_FILE,
} from "./local-stack.js";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";

export interface LocalServerChild {
  postMessage(message: unknown): void;
  kill(): boolean;
  once(event: "exit", listener: (code: number) => void): unknown;
  on(event: "message", listener: (message: unknown) => void): unknown;
}

export class LocalNativeStackController {
  private current: DesktopLocalStackState;
  private child?: LocalServerChild;
  private running?: Promise<DesktopLocalStackState>;
  private stopping?: Promise<DesktopLocalStackState>;
  private intent = 0;
  private url: string;
  constructor(
    private readonly deps: {
      dataDir: string;
      stackDir: string;
      webRoot: string;
      migrationsRoot: string;
      localWebUrl: string;
      build: string;
      hostComputer?: { url: string; token: string };
      launch: (configFile: string) => LocalServerChild;
      onState?: (state: DesktopLocalStackState) => void;
    },
  ) {
    this.current = initialStackState(deps.build);
    this.url = deps.localWebUrl;
  }
  webUrl() {
    return this.url;
  }
  state() {
    return this.current;
  }
  private phase(phase: DesktopLocalStackState["phase"], message: string | null = null) {
    this.current = { ...this.current, phase, message };
    this.deps.onState?.(this.current);
    return this.current;
  }
  async matchesDesiredStack(url = this.url) {
    return url === this.url && this.child !== undefined && this.current.phase === "ready";
  }
  start(): Promise<DesktopLocalStackState> {
    if (this.running) return this.running;
    const intent = ++this.intent;
    this.running = (async () => {
      await this.stopping;
      if (intent !== this.intent) return this.current;
      if (await this.matchesDesiredStack()) return this.current;
      this.phase("preparing");
      try {
        await mkdir(this.deps.dataDir, { recursive: true, mode: 0o700 });
        await mkdir(this.deps.stackDir, { recursive: true, mode: 0o700 });
        const savedToken = await readPrivateFile(
          path.join(this.deps.stackDir, STACK_TOKEN_FILE),
          128,
        );
        const token =
          savedToken && /^[a-f0-9]{64}$/.test(savedToken)
            ? savedToken
            : randomBytes(32).toString("hex");
        await writePrivateFile(path.join(this.deps.stackDir, STACK_TOKEN_FILE), token);
        let port = Number(new URL(this.url).port);
        if (!port) throw new Error("Invalid local server port");
        const probe = createServer();
        try {
          await new Promise<void>((resolve, reject) => {
            probe.once("error", reject);
            probe.listen(port, "127.0.0.1", resolve);
          });
        } catch {
          port = await allocateLoopbackPort();
        } finally {
          if (probe.listening) await new Promise<void>((resolve) => probe.close(() => resolve()));
        }
        this.url = `http://127.0.0.1:${port}`;
        await writePrivateFile(path.join(this.deps.stackDir, STACK_WEB_URL_FILE), this.url);
        const configFile = path.join(this.deps.dataDir, "server.json");
        await writePrivateFile(
          configFile,
          JSON.stringify({
            dataDir: this.deps.dataDir,
            webRoot: this.deps.webRoot,
            migrationsRoot: this.deps.migrationsRoot,
            port,
            token,
            build: this.deps.build,
            hostComputer: this.deps.hostComputer,
          }),
        );
        if (intent !== this.intent) return this.current;
        this.phase("starting");
        const child = this.deps.launch(configFile);
        this.child = child;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new Error("Local server startup timed out. Retry to recover your saved data."),
              ),
            180000,
          );
          child.on("message", (message) => {
            if (
              message &&
              typeof message === "object" &&
              "type" in message &&
              message.type === "ready" &&
              "origin" in message &&
              message.origin === this.url
            ) {
              clearTimeout(timer);
              resolve();
            }
          });
          child.once("exit", () => {
            clearTimeout(timer);
            if (this.child === child) {
              this.child = undefined;
              if (this.current.phase === "ready" && intent === this.intent)
                this.phase("failed", "Local server stopped. Restart to recover your saved work.");
            }
            reject(new Error("Local server stopped during startup. Your saved data is retained."));
          });
        });
        if (intent === this.intent) this.phase("ready");
      } catch (error) {
        await this.stopChild();
        if (intent === this.intent)
          this.phase(
            "failed",
            error instanceof Error ? error.message : "Could not start the local server.",
          );
      }
      return this.current;
    })().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  abort() {
    ++this.intent;
    void this.stop();
  }
  private async stopChild() {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 15000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.postMessage("stop");
    });
  }
  stop(): Promise<DesktopLocalStackState> {
    if (this.stopping) return this.stopping;
    ++this.intent;
    this.stopping = this.stopChild()
      .then(() => this.phase("idle"))
      .finally(() => {
        this.stopping = undefined;
      });
    return this.stopping;
  }
}

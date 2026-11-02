import { realpath } from "node:fs/promises";
import path from "node:path";
import type { ProjectRunState } from "../../../../contracts/project-runner.js";
import { spawnOwnedCommand } from "../../../packages/adapters/src/desktop-process-tree.js";
import { nativeShellCommandArgv } from "../../../packages/adapters/src/native-shell.js";
import { hostCommandEnvironment } from "../../../packages/adapters/src/sandbox-command-environment.js";
import type { LoadedProjectRun } from "./project-run-config.js";
import { inside, serviceOrder } from "./project-run-config.js";

type Owned = ReturnType<typeof spawnOwnedCommand>;
export const emptyRunState = (): ProjectRunState => ({
  phase: "idle",
  profiles: [],
  services: [],
  urls: [],
  logs: "",
});

/** Process lifetime belongs to this manager, never to the model turn or browser tab. */
export class ProjectServices {
  state = emptyRunState();
  private owned: Owned[] = [];
  private controller?: AbortController;
  private fingerprint?: string;
  private active?: Promise<void>;
  constructor(
    private readonly options: {
      launch?: typeof spawnOwnedCommand;
      probe?: (url: string) => Promise<boolean>;
    } = {},
  ) {}

  private log(text: string) {
    this.state.logs = (this.state.logs + text).slice(-24000);
  }
  private kill() {
    for (const process of this.owned.reverse()) {
      process.tree.kill();
      process.tree.close();
    }
    this.owned = [];
  }
  stop() {
    this.controller?.abort();
    this.controller = undefined;
    this.kill();
    this.state = {
      ...this.state,
      phase: "stopped",
      error: undefined,
      services: this.state.services.map((s) => ({ ...s, phase: "exited" })),
      urls: [],
    };
    return this.state;
  }
  async probe(url: string) {
    if (this.options.probe) return this.options.probe(url);
    try {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      return response.status >= 200 && response.status < 400;
    } catch {
      return false;
    }
  }
  start(project: LoadedProjectRun, profileId: string, validate: () => Promise<void>) {
    if (this.state.phase === "starting" || this.state.phase === "running") {
      if (this.fingerprint !== project.fingerprint || this.state.profile !== profileId)
        throw new Error("Stop the current run before changing its profile or configuration");
      return this.state;
    }
    const services = serviceOrder(project.config, profileId);
    const controller = new AbortController();
    this.controller = controller;
    this.fingerprint = project.fingerprint;
    this.state = {
      phase: "starting",
      project: path.basename(project.root),
      profile: profileId,
      profiles: project.config.profiles.map(({ id, name }) => ({ id, name })),
      services: services.map(({ id }) => ({ id, phase: "waiting", owned: false })),
      urls: [],
      logs: "",
    };
    this.active = this.launch(project, services, profileId, controller, validate);
    return this.state;
  }
  async settled() {
    await this.active;
    return this.state;
  }
  private async launch(
    project: LoadedProjectRun,
    services: LoadedProjectRun["config"]["services"],
    profileId: string,
    controller: AbortController,
    validate: () => Promise<void>,
  ) {
    const signal = controller.signal;
    try {
      for (const service of services) {
        signal.throwIfAborted();
        await validate();
        signal.throwIfAborted();
        // Never treat an unrelated listener as one of this run's services.
        if (service.ready && (await this.probe(service.ready.url)))
          throw new Error(
            `Service ${service.id} already has a listener. Stop it or configure another port.`,
          );
        signal.throwIfAborted();
        const cwd = await realpath(path.resolve(project.root, service.cwd ?? "."));
        if (!inside(project.root, cwd)) throw new Error("Service directory leaves its project");
        signal.throwIfAborted();
        const command =
          typeof service.command === "string"
            ? service.command
            : service.command[process.platform === "win32" ? "win32" : "posix"];
        const item = this.state.services.find((item) => item.id === service.id)!;
        item.phase = "starting";
        const owned = (this.options.launch ?? spawnOwnedCommand)(
          nativeShellCommandArgv(command, {
            platform: process.platform,
            shell: process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/sh",
          }),
          cwd,
          hostCommandEnvironment({ env: { ...service.env, BROWSER: "none" } }),
        );
        this.owned.push(owned);
        item.owned = true;
        let failed: Error | undefined;
        owned.child.stdout.on("data", (chunk) => this.log(`[${service.id}] ${chunk}`));
        owned.child.stderr.on("data", (chunk) => this.log(`[${service.id}] ${chunk}`));
        const fail = (error: Error) => {
          failed = error;
          item.phase = "exited";
          if (!signal.aborted) {
            this.state.phase = "error";
            this.state.error = error.message;
            this.state.urls = [];
            controller.abort();
            this.kill();
          }
        };
        owned.child.once("error", (error) => fail(error));
        owned.child.once("exit", (code) =>
          fail(new Error(`Service ${service.id} exited (${code ?? "signal"})`)),
        );
        const deadline = Date.now() + (service.ready?.timeoutMs ?? 30000);
        if (service.ready) {
          while (!(await this.probe(service.ready.url))) {
            signal.throwIfAborted();
            if (failed) throw failed;
            if (Date.now() >= deadline)
              throw new Error(`Service ${service.id} did not become ready`);
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
        } else await new Promise((resolve) => setTimeout(resolve, 200));
        signal.throwIfAborted();
        if (failed) throw failed;
        await validate();
        signal.throwIfAborted();
        item.phase = "running";
      }
      const profile = project.config.profiles.find((profile) => profile.id === profileId)!;
      if (profile.url && !(await this.probe(profile.url)))
        throw new Error("The project preview did not become ready");
      await validate();
      signal.throwIfAborted();
      this.state.phase = "running";
      const urls = [
        ...(profile.url ? [{ name: profile.name, url: profile.url }] : []),
        ...services.flatMap((service) =>
          service.ready ? [{ name: service.id, url: service.ready.url }] : [],
        ),
      ];
      this.state.urls = urls.filter(
        (entry, index) => urls.findIndex((other) => other.url === entry.url) === index,
      );
    } catch (error) {
      if (this.controller === controller && this.state.phase !== "stopped") {
        // Killing an owned tree emits exit(130); keep the startup refusal as the
        // cause instead of replacing it with the cleanup process exit.
        controller.abort();
        this.state.phase = "error";
        this.state.error ??= error instanceof Error ? error.message : "Project services failed";
        this.kill();
        this.state.services = this.state.services.map((service) => ({
          ...service,
          phase: "exited",
        }));
        this.state.urls = [];
      }
    }
  }
}

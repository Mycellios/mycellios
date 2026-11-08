import { createHash, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import type { AdapterContext, AgentRuntime, ComputerRef } from "@rakazo/adapter-kit";
import { DesktopAgentHost } from "./desktop-agent-host.js";
import { safeNativeCommandError } from "./native-command-journal.js";
import { DesktopSandboxProvider } from "./desktop-sandbox.js";
import type { HostComputerRequest } from "./host-computer-protocol.js";
import {
  HOST_COMPUTER_MAX_BYTES,
  HOST_COMPUTER_MAX_FILE_BYTES,
  hostComputerDeadlineMs,
  hostComputerRequest,
} from "./host-computer-protocol.js";

/** No renderer receives the credential. Docker reaches this listener through its host gateway. */
export async function startHostComputerServer(options: {
  root: string;
  token: string;
  port?: number;
  hostname?: string;
  agentRuntime?: AgentRuntime;
}) {
  if (!/^[a-f0-9]{64}$/.test(options.token)) throw new Error("Invalid local computer credential");
  let enabled = false;
  let updating = false;
  const agentHost = options.agentRuntime ? new DesktopAgentHost(options.agentRuntime) : undefined;
  // Only the native folder picker can grant projects; this map has no HTTP write method.
  const projects = new Map<string, string>();
  const taskProjects = new Map<string, { botId: string; key: string; active: boolean; allowPrimaryRun?: (runId: string) => Promise<boolean> }>();
  const projectGuards = new Map<
    string,
    {
      defaultFiles: boolean;
      environment?: Record<string, string>;
      commandScheduler?: string;
      validate(): Promise<void>;
    }
  >();
  const projectLocks = new Set<string>();
  const active = new Map<
    AbortController,
    { botId: string; runId?: string; method: string } | undefined
  >();
  const updateNotices = new Map<AbortController, () => void>();
  const providers = new Map<string, DesktopSandboxProvider>();
  function providerFor(botId: string) {
    let provider = providers.get(botId);
    if (!provider) {
      provider = new DesktopSandboxProvider({
        root: options.root,
        hostRoots: () => [projects.get(botId) ?? homedir()],
        maxFileBytes: HOST_COMPUTER_MAX_FILE_BYTES,
      });
      providers.set(botId, provider);
    }
    return provider;
  }
  const secret = Buffer.from(`Bearer ${options.token}`);
  const server = createServer(async (request, response) => {
    const credential = Buffer.from(request.headers.authorization ?? "");
    // Reject browser-origin requests even when they somehow obtain a credential; no CORS.
    if (
      request.headers.origin ||
      credential.length !== secret.length ||
      !timingSafeEqual(credential, secret)
    ) {
      response.writeHead(401).end();
      return;
    }
    if (updating) {
      response.writeHead(503, { "x-mycellios-desktop-error": "desktop_updating" }).end();
      return;
    }
    if (!enabled) {
      response.writeHead(403).end();
      return;
    }
    if (request.method !== "POST" || request.url !== "/computer") {
      response.writeHead(404).end();
      return;
    }
    // Keep four bounded slots for cancellation and shutdown when commands fill execution capacity.
    if (active.size >= 20) {
      response.writeHead(429).end();
      return;
    }
    const controller = new AbortController();
    active.set(controller, undefined);
    const destroyResponse = () => response.destroy();
    controller.signal.addEventListener("abort", destroyResponse, { once: true });
    updateNotices.set(controller, () => {
      // End a complete native frame before aborting work. Destroying the socket
      // here would hide the planned interruption from the embedded worker.
      controller.signal.removeEventListener("abort", destroyResponse);
      if (!response.destroyed && !response.writableEnded) {
        const dispatched = response.headersSent;
        if (!dispatched) response.writeHead(503, {"x-mycellios-desktop-error":"desktop_updating"});
        response.end(dispatched ? JSON.stringify({error:"The PC is updating; pending work will resume after reconnecting.",code:"desktop_updating",dispatched:true}) + "\n" : undefined);
      }
      controller.abort();
    });
    const abort = () => controller.abort();
    response.once("close", abort);
    let heartbeat: NodeJS.Timeout | undefined;
    let timer = setTimeout(abort, 30_000);
    timer.unref();
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > HOST_COMPUTER_MAX_BYTES) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      if (controller.signal.aborted || response.writableEnded) return;
      const parsed = hostComputerRequest.safeParse(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      if (!parsed.success) {
        response.writeHead(400).end();
        return;
      }
      if (!enabled || controller.signal.aborted) {
        response.writeHead(403).end();
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(abort, hostComputerDeadlineMs(parsed.data));
      timer.unref();
      const lifecycle =
        parsed.data.method === "cancelRunWork" ||
        parsed.data.method === "stop" ||
        parsed.data.method === "destroy";
      if (!lifecycle && active.size > 16) {
        response.writeHead(429).end();
        return;
      }
      active.set(controller, {
        botId: parsed.data.botId,
        runId: parsed.data.runId,
        method: parsed.data.method,
      });
      response.writeHead(200, {
        "content-type": "application/x-ndjson",
        "cache-control": "no-store",
      });
      response.flushHeaders();
      // Quiet commands must keep HTTP clients and intermediaries from timing out between frames.
      heartbeat = setInterval(() => {
        if (!controller.signal.aborted && !response.destroyed)
          response.write(`${JSON.stringify({ heartbeat: true })}\n`);
      }, 30_000);
      heartbeat.unref();
      const context: AdapterContext = {
        operationId: "desktop-host",
        traceId: "desktop-host",
        spaceId: "local",
        userId: "local",
        runId: parsed.data.runId,
        signal: controller.signal,
      };
      for await (const value of dispatch(parsed.data, context)) {
        if (controller.signal.aborted) break;
        if (!response.write(`${JSON.stringify({ value })}\n`))
          await once(response, "drain", { signal: controller.signal });
      }
      if (!controller.signal.aborted) response.end(`${JSON.stringify({ done: true })}\n`);
    } catch (error) {
      let message = "Local computer operation failed";
      if (
        error instanceof Error &&
        (error.message === "Path escapes the computer workspace" ||
          /^computer file exceeds \d+ bytes$/.test(error.message) ||
          error.message === "Link this agent's project on this computer before continuing." ||
          error.message === "Project link in progress" ||
          safeNativeCommandError(error) ||
          error.message === "Project binding changed" ||
          error.message === "Link this task on this computer before continuing." ||
          error.message.startsWith("This Mico has an isolated task running"))
      ) {
        message = error.message;
      } else if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        message = "computer file not found";
      }
      if (!response.headersSent) response.writeHead(400);
      const missingSession = error instanceof Error && error.message === "Desktop agent session changed";
      if (!response.destroyed && !response.writableEnded) response.end(`${JSON.stringify({ error: message, ...(missingSession ? { code: "desktop_session_missing" } : {}) })}\n`);
    } finally {
      clearTimeout(timer);
      clearInterval(heartbeat);
      active.delete(controller);
      updateNotices.delete(controller);
      response.removeListener("close", abort);
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 32;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.hostname ?? "0.0.0.0", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local computer unavailable");

  // Reconstruct only our own workspace path. Never trust a caller's providerRef or filesystem root.
  function ref(botId: string): ComputerRef {
    const key = createHash("sha256").update(botId).digest("hex");
    return {
      id: `desktop-${key}`,
      botId: key,
      kind: "desktop",
      providerRef: path.join(options.root, "desktop-computers", key),
    };
  }
  async function* dispatch(
    input: HostComputerRequest,
    context: AdapterContext,
  ): AsyncIterable<unknown> {
    if (input.method === "agentRun" || input.method === "agentMessage") {
      if (!agentHost || !enabled || context.signal.aborted) throw Error("Desktop agent executor unavailable");
      if (input.method === "agentMessage") {
        agentHost.message(input.sessionId, input.message, input.botId, input.runId, input.projectSessionId);
        yield { accepted: true }; return;
      }
      yield* agentHost.run(input.sessionId, input.request, input.botId, input.runId, { ...context, projectSessionId: input.projectSessionId });
      return;
    }
    if (
      !input.projectSessionId &&
      [...taskProjects.values()].some(task => task.botId === input.botId && task.active) &&
      [
        "execute",
        "readFile",
        "writeFile",
        "listFiles",
        "exportWorkspace",
        "workspaceDirectories",
      ].includes(input.method)
    ) {
      const task = [...taskProjects.values()].find(task => task.botId === input.botId && task.active && task.allowPrimaryRun);
      if (!input.runId || !task?.allowPrimaryRun || !(await task.allowPrimaryRun(input.runId))) throw new Error(
        "This Mico has an isolated task running. Unscoped file operations are disabled until it finishes.",
      );
    }
    if (input.projectSessionId) {
      const task = taskProjects.get(input.projectSessionId);
      if (!task || !task.active || task.botId !== input.botId)
        throw new Error("Link this task on this computer before continuing.");
      input = { ...input, botId: task.key };
      const provider = providerFor(input.botId),
        computer = ref(input.botId);
      if (!(await provider.isRunning(computer, context))) {
        await provider.provision({ botId: computer.botId, homePath: "" }, context);
        await provider.prepare(computer, context);
      }
    }
    const cleanup = ["stop", "destroy", "cancelRunWork"].includes(input.method);
    if (!cleanup) {
      if (projectLocks.has(input.botId)) throw new Error("Project link in progress");
      const grant = projectGuards.get(input.botId);
      await grant?.validate();
      if (!enabled || context.signal.aborted) throw new Error("Local computer access is disabled");
      if (projectLocks.has(input.botId) || projectGuards.get(input.botId) !== grant)
        throw new Error("Project binding changed");
    }
    const computer = ref(input.botId);
    const provider = providerFor(input.botId);
    async function fileTarget(value: string) {
      const project = projects.get(input.botId);
      const portable = value.replaceAll("\\", "/");
      const mounted = portable.replace(/^\/(?!\/)/, "");
      if (
        !project ||
        (!projectGuards.has(input.botId) &&
          !(mounted === "project" || mounted.startsWith("project/")))
      )
        return { provider, computer, path: value, project: false };
      if ((await realpath(project)) !== project)
        throw new Error("The selected project changed. Open it again.");
      return {
        provider: new DesktopSandboxProvider({ maxFileBytes: HOST_COMPUTER_MAX_FILE_BYTES }),
        computer: { ...computer, id: `project-${computer.id}`, providerRef: project },
        path:
          mounted === "project" ? "" : mounted.startsWith("project/") ? mounted.slice(8) : value,
        project: true,
      };
    }
    switch (input.method) {
      case "environment":
        yield {
          ...(await provider.environment()),
          projectPath: projects.get(input.botId),
          projectRoot: projectGuards.has(input.botId),
          projectSessionId: input.projectSessionId,
          ...(input.projectSessionId ? { taskIsolation: "worktree-v1" } : {}),
        };
        break;
      case "provision": {
        const result = await provider.provision({ botId: computer.botId, homePath: "" }, context);
        yield { ...result, botId: input.botId, providerRef: `host:${computer.botId}` };
        break;
      }
      case "isRunning":
        yield await provider.isRunning(computer, context);
        break;
      case "prepare":
        await provider.prepare(computer, context);
        yield null;
        break;
      case "execute": {
        if (!(await provider.isRunning(computer, context)))
          throw new Error("Local computer stopped");
        if (
          projects.has(input.botId) &&
          (await realpath(projects.get(input.botId)!)) !== projects.get(input.botId)
        )
          throw new Error("The selected project changed. Open it again.");
        const projectRoot = projects.get(input.botId);
        const commandCwd =
          projectRoot && projectGuards.has(input.botId)
            ? path.resolve(projectRoot, input.command.cwd ?? ".")
            : (input.command.cwd ?? projectRoot);
        if (projectRoot && projectGuards.has(input.botId) && commandCwd) {
          const relative = path.relative(projectRoot, commandCwd);
          if (
            relative === ".." ||
            relative.startsWith(".." + path.sep) ||
            path.isAbsolute(relative)
          )
            throw new Error("Command working directory must stay in the linked project.");
        }
        const scheduler = projectGuards.get(input.botId)?.commandScheduler;
        let argv = input.command.argv;
        if (scheduler) {
          if (process.platform !== "win32" || !path.isAbsolute(scheduler))
            throw new Error("Configured task scheduler is unavailable");
          await stat(scheduler);
          if (argv.some((part) => /compilar\.ps1/i.test(part)))
            throw new Error(
              "The task executor already owns the workstation queue; do not nest compilar.ps1.",
            );
          const command =
            "& " + argv.map((value) => "'" + value.replaceAll("'", "''") + "'").join(" ");
          argv = [
            "pwsh.exe",
            "-NoProfile",
            "-File",
            scheduler,
            "-WorkingDirectory",
            commandCwd ?? projectRoot!,
            "-Command",
            command,
          ];
        }
        yield* provider.execute(
          computer,
          {
            ...input.command,
            argv,
            cwd: commandCwd,
            env: { ...projectGuards.get(input.botId)?.environment, ...input.command.env },
          },
          context,
        );
        break;
      }
      case "commandStatus":
        yield await provider.commandStatus(computer, input.commandId);
        break;
      case "workspaceDirectories":
        yield await provider.workspaceDirectories(computer, input.directories, context);
        break;
      case "cancelRunWork":
        await provider.cancelRunWork(computer, computer.id, input.targetRunId, context);
        for (const [controller, work] of active) {
          if (
            work?.method === "execute" &&
            work.botId === input.botId &&
            work.runId === input.targetRunId
          )
            controller.abort();
        }
        yield null;
        break;
      case "listFiles": {
        const target = await fileTarget(input.path);
        const files = await target.provider.listFiles(target.computer, target.path, context);
        yield target.project
          ? files.map((file) => ({ ...file, path: `project/${file.path}` }))
          : files;
        break;
      }
      case "readFile": {
        const target = await fileTarget(input.path);
        yield Buffer.from(
          await target.provider.readFile(target.computer, target.path, context, {
            maxBytes: input.maxBytes ?? HOST_COMPUTER_MAX_FILE_BYTES,
          }),
        ).toString("base64");
        break;
      }
      case "writeFile": {
        const target = await fileTarget(input.file.path);
        await target.provider.writeFile(target.computer, {
          ...input.file,
          path: target.path,
          content: Buffer.from(input.file.content, "base64"),
        });
        yield null;
        break;
      }
      case "exportWorkspace":
        for await (const file of provider.exportWorkspace(computer)) {
          if (file.content.byteLength > HOST_COMPUTER_MAX_FILE_BYTES)
            throw new Error(`computer file exceeds ${HOST_COMPUTER_MAX_FILE_BYTES} bytes`);
          yield { ...file, content: Buffer.from(file.content).toString("base64") };
        }
        break;
      case "snapshot":
        yield await provider.snapshot(computer, context);
        break;
      case "stop":
      case "destroy":
        for (const [controller, work] of active) {
          if (work?.botId === input.botId && controller.signal !== context.signal)
            controller.abort();
        }
        if (input.method === "destroy") await provider.destroy(computer, context);
        else await provider.stop(computer, context);
        yield null;
        break;
    }
  }
  return {
    port: address.port,
    async bindTaskProject(
      sessionId: string,
      botId: string,
      folder: string,
      validate: () => Promise<void>,
      scheduler?: string,
      allowPrimaryRun?: (runId: string) => Promise<boolean>,
    ) {
      if (!/^[a-zA-Z0-9_-]{1,256}$/.test(sessionId) || !botId || botId.length > 256)
        throw new Error("Invalid task binding");
      await validate();
      if (providers.get(botId)?.hasActiveCommands())
        throw new Error("Finish the active local task before changing its project");
      const directory = await realpath(folder);
      if ([...taskProjects].some(([id, task]) => id !== sessionId && task.active && projects.get(task.key) === directory))
        throw new Error("Each conversation needs its own worktree.");
      try {
        const release = (key: string) => () => {
          const task = taskProjects.get(sessionId);
          if (task?.key === key) task.active = false;
          providers.get(key)?.cancelAllCommands();
        };
        const existing = taskProjects.get(sessionId);
        if (existing) {
          if (existing.botId !== botId || projects.get(existing.key) !== (await realpath(folder)))
            throw new Error("Task binding changed");
          existing.active = true;
          existing.allowPrimaryRun = allowPrimaryRun;
          return release(existing.key);
        }
        const key =
          "task-" +
          createHash("sha256")
            .update(JSON.stringify([sessionId, botId]))
            .digest("hex");
        await this.selectProject(key, folder, {
          defaultFiles: true,
          validate: async () => {
            if (!taskProjects.get(sessionId)?.active)
              throw new Error("This task execution is no longer active.");
            await validate();
          },
          commandScheduler: scheduler,
        });
        taskProjects.set(sessionId, { botId, key, active: true, allowPrimaryRun });
        return release(key);
      } catch (error) {
        throw error;
      }
    },
    taskProject(botId: string, sessionId: string) {
      const task = taskProjects.get(sessionId);
      return task?.active && task.botId === botId ? projects.get(task.key) : undefined;
    },
    /** Native-only location of this agent's existing default workspace. */
    workspace: (botId: string) => ref(botId).providerRef,
    lockProject(botId: string) {
      if (
        projectLocks.has(botId) || providers.get(botId)?.hasActiveCommands() ||
        [...active.values()].some((work) => !work || work.botId === botId)
      )
        throw new Error("Wait for this agent's current operation to finish");
      projectLocks.add(botId);
      return () => projectLocks.delete(botId);
    },
    async selectProject(
      botId: string,
      folder: string,
      guard?: {
        defaultFiles: boolean;
        environment?: Record<string, string>;
        commandScheduler?: string;
        validate(): Promise<void>;
      },
    ) {
      if (!enabled) throw new Error("Local computer access is disabled");
      if (!botId || botId.length > 256) throw new Error("Invalid agent");
      const directory = await realpath(folder);
      if (!(await stat(directory)).isDirectory()) throw new Error("Choose a project folder");
      const root = path.parse(directory).root;
      if (directory === root || directory === homedir())
        throw new Error("Choose a project folder, rather than your entire computer");
      if (!enabled) throw new Error("Local computer access is disabled");
      if (providers.get(botId)?.hasActiveCommands() || [...active.values()].some((work) => work?.botId === botId))
        throw new Error("Wait for this agent's current operation to finish");
      projects.set(botId, directory);
      if (guard) projectGuards.set(botId, guard);
      else projectGuards.delete(botId);
      return { name: path.basename(directory), path: directory };
    },
    project: (botId: string) => {
      const directory = projects.get(botId);
      const guard = projectGuards.get(botId);
      return directory
        ? {
            name: path.basename(directory),
            path: directory,
            ...(guard ? { development: true } : {}),
          }
        : null;
    },
    isEnabled: () => enabled && !updating,
    async prepareUpdate() {
      updating = true;
      for (const [controller, notice] of updateNotices)
        if (active.get(controller)?.method !== "writeFile") notice();
      for (const provider of providers.values()) provider.cancelAllCommands();
      const deadline = Date.now() + 15_000;
      const settle = Promise.all([...providers.values()].map(provider => provider.settleCommands()));
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([settle, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Local commands are still stopping")), 15_000); })]);
        while ([...active.values()].some(work => work?.method === "writeFile")) {
          if (Date.now() >= deadline) throw new Error("A file write is still finishing");
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      } finally { clearTimeout(timeout); }
    },
    cancelUpdate() { updating = false; },
    clearProjects() {
      for (const provider of providers.values()) provider.cancelAllCommands();
      taskProjects.clear();
      projects.clear();
      projectGuards.clear();
      providers.clear();
    },
    hasActiveWork: () =>
      [...providers.values()].some(provider => provider.hasActiveCommands()) ||
      [...active.values()].some(
        (work) => work?.method === "execute" || work?.method === "writeFile" || work?.method === "agentRun",
      ),
    setEnabled(value: boolean) {
      enabled = value;
      if (!value) {
        for (const controller of active.keys()) controller.abort();
        for (const provider of providers.values()) provider.cancelAllCommands();
      }
    },
    async close() {
      enabled = false;
      for (const provider of providers.values()) provider.cancelAllCommands();
      await Promise.all([...providers.values()].map(provider => provider.settleCommands()));
      for (const controller of active.keys()) controller.abort();
      for (const provider of providers.values()) provider.cancelAllCommands();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

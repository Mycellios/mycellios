import { homedir } from "node:os";
import type {
  AdapterContext,
  CommandRequest,
  ComputerActionRequest,
  ComputerInput,
  ComputerRef,
  ControlLeaseRef,
  PortableFile,
  ProcessEvent,
  SandboxProvider,
  ScreenRequest,
  TerminalRequest,
  WorkspaceDirectoryRequest,
} from "@mycellios/adapter-kit";
import type { NativeEngineAccountRequest, NativeEngineInstallRequest } from "@mycellios/contracts";
import type { PrismaClient } from "@mycellios/db";
import { ComputerUpdatingError, DesktopUnreachableError } from "./computer-errors.js";
import { cancelComputerRunWork } from "./computer-idle.js";
import { manageComputerWorkspaceDirectories } from "./computer-workspace.js";
import { desktopRelayPresence, desktopRelayTransport } from "./desktop-relay.js";
import type { DesktopPresence } from "./desktop-relay.js";
import { assertHostCommandsAllowed, DesktopSandboxProvider } from "./desktop-sandbox.js";
import { HostComputerSandbox } from "./host-computer-sandbox.js";
import { createSandboxProvider, type SandboxProviderOptions } from "./sandbox-factory.js";

export function sandboxKindForBot(envKind: string, computerHost: string | null | undefined) {
  if ((envKind === "docker" || envKind === "none") && computerHost === "this-mac") return "desktop";
  return envKind;
}

export function createRunSandbox(
  kind: string,
  opts: SandboxProviderOptions & {
    prisma?: PrismaClient;
    desktopRelay?: { url: string; key: string };
  },
): SandboxProvider {
  if (kind === "desktop") {
    assertHostCommandsAllowed();
    return new DesktopSandboxProvider({
      root: opts.dataDir,
      hostRoots: [homedir()],
    });
  }
  const primary = createSandboxProvider(kind, opts);
  if (opts.desktopRelay) {
    const presence = desktopRelayPresence(opts.desktopRelay.url, opts.desktopRelay.key);
    return new HostAwareSandbox(
      primary,
      new HostComputerSandbox(
        "",
        "",
        desktopRelayTransport(opts.desktopRelay.url, opts.desktopRelay.key),
      ),
      async (context) => await presence(context) === "connected",
      presence,
    );
  }
  if (
    !opts.prisma ||
    (kind !== "docker" && !(kind === "none" && opts.hostComputerUrl && opts.hostComputerToken))
  )
    return primary;
  return new HostAwareSandbox(
    primary,
    new HostComputerSandbox(opts.hostComputerUrl ?? "", opts.hostComputerToken ?? ""),
    async () => {
      const settings = await opts.prisma!.deploymentSettings.findUnique({
        where: { id: "default" },
      });
      return settings?.computerHost === "this-mac";
    },
  );
}

export class HostAwareSandbox implements SandboxProvider {
  readonly pageBrowser?: SandboxProvider["pageBrowser"];
  readonly connectTabView?: SandboxProvider["connectTabView"];
  readonly appControl?: SandboxProvider["appControl"];

  constructor(
    private readonly isolated: SandboxProvider,
    private readonly host: SandboxProvider,
    private readonly hostEnabled: (context?: AdapterContext) => Promise<boolean>,
    /** Tells an offline PC apart from one that is online without this Mico; absent: enabled or offline. */
    private readonly presence?: (context: AdapterContext) => Promise<DesktopPresence>,
  ) {
    if (host.appControl) {
      this.appControl = (computer, request, context) => {
        const provider = this.route(computer);
        if (!provider.appControl) throw new Error("App control is only available on a connected PC.");
        return provider.appControl(computer, request, context);
      };
    }
    if (isolated.pageBrowser || host.pageBrowser) {
      this.pageBrowser = (computer, request, context) => {
        const provider = this.route(computer);
        return provider.pageBrowser
          ? provider.pageBrowser(computer, request, context)
          : Promise.resolve({
              ok: false,
              uncertain: false,
              fallback: "computer_act",
              error: "Page browser is unavailable on this computer.",
            });
      };
    }
    // Without this the API sees no tab view and every handoff falls back to the desktop.
    if (isolated.connectTabView || host.connectTabView) {
      this.connectTabView = (computer, request, context) => {
        const provider = this.route(computer);
        if (!provider.connectTabView) {
          return Promise.reject(new Error("tab view is unavailable on this computer"));
        }
        return provider.connectTabView(computer, request, context);
      };
    }
  }

  describe() {
    return this.isolated.describe();
  }

  private route(computer: ComputerRef) {
    return computer.kind === "desktop" ? this.host : this.isolated;
  }

  /**
   * Whether the PC can take this work. A check that got no answer only matters when the
   * work belongs on the PC; anything else keeps using the server computer, as it would
   * with the PC offline, so a busy relay (or one handing its PCs to a new server version)
   * never blocks Micos that do not use a PC.
   */
  private async hostAvailable(context: AdapterContext, pcRequired: boolean) {
    try {
      return await this.hostEnabled(context);
    } catch (error) {
      if (!pcRequired && (error instanceof DesktopUnreachableError || error instanceof ComputerUpdatingError)) return false;
      // Work that needs the PC pauses and continues once it reconnects, as for a PC update.
      if (error instanceof ComputerUpdatingError) context.onComputerUpdate?.(error.dispatched);
      throw error;
    }
  }

  async provisionKind(context?: AdapterContext) {
    const provider = !context?.cloudWorkspace && !context?.isolatedWorkspace && (await this.hostEnabled(context))
      ? this.host : this.isolated;
    return provider.describe().id as ComputerRef["kind"];
  }

  async hostPresence(context: AdapterContext): Promise<DesktopPresence> {
    if (this.presence) return this.presence(context);
    return (await this.hostEnabled(context)) ? "connected" : "offline";
  }

  async provision(
    request: {
      botId: string;
      homePath: string;
      providerRef?: string;
      providerKind?: ComputerRef["kind"];
    },
    context: AdapterContext,
  ) {
    const enabled = !context.cloudWorkspace && !context.isolatedWorkspace &&
      (await this.hostAvailable(context, request.providerKind === "desktop"));
    if (request.providerKind === "desktop" && !enabled)
      throw new Error(
        "The selected local computer is disconnected. Reconnect Desktop before continuing this project.",
      );
    const provider = enabled ? this.host : this.isolated;
    const providerKind = provider.describe().id;
    return provider.provision(
      {
        ...request,
        providerRef: request.providerKind === providerKind ? request.providerRef : undefined,
      },
      context,
    );
  }

  async isRunning(computer: ComputerRef, context: AdapterContext): Promise<boolean> {
    const provider = !context.cloudWorkspace && !context.isolatedWorkspace &&
      (await this.hostAvailable(context, computer.kind === "desktop"))
      ? this.host : this.isolated;
    if (provider.describe().id !== computer.kind) return false;
    return provider.isRunning?.(computer, context) ?? false;
  }

  async nativeEngines(context: AdapterContext) {
    return this.host.nativeEngines?.(context);
  }

  async nativeEngineState(context: AdapterContext) {
    return this.host.nativeEngineState?.(context);
  }

  async nativeEngineAccount(context: AdapterContext, request: NativeEngineAccountRequest) {
    if (!this.host.nativeEngineAccount) throw new Error("This server cannot reach the PC's AI programs.");
    return this.host.nativeEngineAccount(context, request);
  }

  async nativeEngineUsage(context: AdapterContext) {
    return this.host.nativeEngineUsage?.(context) ?? {};
  }

  async nativeEngineInstall(context: AdapterContext, request: NativeEngineInstallRequest) {
    if (!this.host.nativeEngineInstall) throw new Error("This server cannot reach the PC's AI programs.");
    return this.host.nativeEngineInstall(context, request);
  }

  async environment(computer: ComputerRef, context: AdapterContext) {
    const provider = this.route(computer);
    return provider.environment?.(computer, context);
  }

  prepare(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).prepare(computer, context);
  }

  async *execute(
    computer: ComputerRef,
    request: CommandRequest,
    context: AdapterContext,
  ): AsyncIterable<ProcessEvent> {
    if (computer.kind === "desktop" && !(await this.hostEnabled(context)))
      throw new Error("Local computer access is disabled");
    yield* this.route(computer).execute(computer, request, context);
  }

  workspaceDirectories(
    computer: ComputerRef,
    request: WorkspaceDirectoryRequest,
    context: AdapterContext,
  ) {
    return manageComputerWorkspaceDirectories(this.route(computer), computer, request, context);
  }

  async commandStatus(computer: ComputerRef, commandId: string | undefined, context: AdapterContext) {
    if (computer.kind === "desktop" && !(await this.hostEnabled(context)))
      throw new Error("Local computer access is disabled");
    const provider = this.route(computer);
    if (!provider.commandStatus) throw new Error("This computer does not support command receipts");
    return provider.commandStatus(computer, commandId, context);
  }

  cancelRunWork(computer: ComputerRef, computerId: string, runId: string, context: AdapterContext) {
    const provider = this.route(computer);
    if (provider.cancelRunWork) return provider.cancelRunWork(computer, computerId, runId, context);
    if (computer.kind === "desktop") return Promise.reject(new Error("Native work cancellation is unavailable"));
    return cancelComputerRunWork(provider, computer, computerId, runId, context);
  }

  connectScreen(computer: ComputerRef, request: ScreenRequest, context: AdapterContext) {
    return this.route(computer).connectScreen(computer, request, context);
  }

  connectTerminal(computer: ComputerRef, request: TerminalRequest, context: AdapterContext) {
    const provider = this.route(computer);
    if (!provider.connectTerminal) {
      return Promise.reject(new Error("terminal is unavailable on this computer"));
    }
    return provider.connectTerminal(computer, request, context);
  }

  sendInput(
    computer: ComputerRef,
    input: ComputerInput,
    lease: ControlLeaseRef,
    context: AdapterContext,
  ) {
    return this.route(computer).sendInput(computer, input, lease, context);
  }

  observe(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).observe(computer, context);
  }

  act(computer: ComputerRef, request: ComputerActionRequest, context: AdapterContext) {
    return this.route(computer).act(computer, request, context);
  }

  listFiles(computer: ComputerRef, path: string, context: AdapterContext) {
    return this.route(computer).listFiles(computer, path, context);
  }

  readFile(
    computer: ComputerRef,
    path: string,
    context: AdapterContext,
    options?: { maxBytes?: number },
  ) {
    return this.route(computer).readFile(computer, path, context, options);
  }

  writeFile(computer: ComputerRef, file: PortableFile, context: AdapterContext) {
    return this.route(computer).writeFile(computer, file, context);
  }

  exportWorkspace(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).exportWorkspace(computer, context);
  }

  importWorkspace(
    computer: ComputerRef,
    files: AsyncIterable<PortableFile>,
    context: AdapterContext,
  ) {
    return this.route(computer).importWorkspace(computer, files, context);
  }

  snapshot(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).snapshot(computer, context);
  }

  billsWhileRunning(computer: ComputerRef): boolean {
    return this.route(computer).billsWhileRunning?.(computer) ?? false;
  }

  keepAlive(computer: ComputerRef) {
    return this.route(computer).keepAlive?.(computer) ?? Promise.resolve();
  }

  releaseScreen(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).releaseScreen?.(computer, context) ?? Promise.resolve();
  }

  setScreenControl(
    computer: ComputerRef,
    interactive: boolean,
    context: AdapterContext,
    controlToken?: string,
  ) {
    return (
      this.route(computer).setScreenControl?.(computer, interactive, context, controlToken) ??
      Promise.resolve()
    );
  }

  stop(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).stop(computer, context);
  }

  destroy(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).destroy(computer, context);
  }
}

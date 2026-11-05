import { dialog, ipcMain } from "electron";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import type { prepareHostComputer } from "./host-computer.js";
import { ProjectWorkspaces } from "./project-workspaces.js";

export function installProjectConversations(options: {
  storage: string;
  host: Awaited<ReturnType<typeof prepareHostComputer>>;
  context(event: IpcMainInvokeEvent): Promise<{
    window: BrowserWindow; base: string; spaceId: string | null; validate(): Promise<void>;
  }>;
}) {
  const workspaces = new ProjectWorkspaces(options.storage);
  const tasks = new Map<string, { folder: string | null; validate(): Promise<void> }>();
  ipcMain.handle("desktop.computer.prepareTask", async (event, input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Invalid project conversation");
    const { botId, taskThreadId } = input as { botId: unknown; taskThreadId: unknown };
    if ([botId, taskThreadId].some(v => typeof v !== "string" || !/^[a-zA-Z0-9_-]{1,256}$/.test(v)))
      throw new Error("Invalid project conversation");
    const bot = botId as string, thread = taskThreadId as string;
    const context = await options.context(event);
    const read = async () => {
      await context.validate();
      const response = await context.window.webContents.session.fetch(`${context.base}/rpc/development/projectTask`, {
        method: "POST", credentials: "include", redirect: "error",
        headers: { "content-type": "application/json", origin: new URL(context.base).origin,
          ...(context.spaceId ? { "x-rakazo-space-id": context.spaceId } : {}) },
        body: JSON.stringify({ json: { botId: bot, taskThreadId: thread } }),
        signal: AbortSignal.timeout(10000), bypassCustomProtocolHandlers: true,
      });
      if (!response.ok) throw new Error("Reconnect this project conversation before continuing.");
      const envelope = await response.json() as { json?: unknown };
      const raw = envelope?.json;
      if (raw === null) return null;
      if (!raw || typeof raw !== "object") throw new Error("Invalid owned project");
      const value = raw as Record<string, unknown>;
      if (typeof value.projectId !== "string" || !/^[a-f0-9-]{36}$/i.test(value.projectId) || typeof value.name !== "string" ||
        typeof value.userId !== "string" || typeof value.spaceId !== "string") throw new Error("Invalid owned project");
      return value as { projectId: string; name: string; userId: string; spaceId: string };
    };
    const project = await read();
    if (!project) {
      tasks.set(JSON.stringify([bot, thread]), { folder: null, validate: async () => {
        if (await read() !== null) throw new Error("The task project changed.");
      } });
      return; // Ordinary Mico side threads keep their existing workspace.
    }
    const scope = JSON.stringify([context.base, project.userId, project.spaceId]);
    const validate = async () => {
      if (!options.host.isEnabled()) throw new Error("Local computer access was revoked.");
      const current = await read();
      if (!current || current.projectId !== project.projectId || current.userId !== project.userId || current.spaceId !== project.spaceId)
        throw new Error("The project account changed.");
    };
    const folder = await workspaces.prepare(scope, project.projectId, thread, async () => {
      const selected = await dialog.showOpenDialog(context.window, { title: `Open project · ${project.name}`, properties: ["openDirectory"] });
      return selected.canceled ? null : selected.filePaths[0] ?? null;
    }, validate);
    if (!folder) throw new Error("No project folder was selected. The message was not sent.");
    await options.host.bindTaskProject(thread, bot, folder, validate, undefined, async runId => {
      await context.validate();
      const response = await context.window.webContents.session.fetch(`${context.base}/rpc/development/primaryRun`, {
        method: "POST", credentials: "include", redirect: "error",
        headers: { "content-type": "application/json", origin: new URL(context.base).origin,
          ...(context.spaceId ? { "x-rakazo-space-id": context.spaceId } : {}) },
        body: JSON.stringify({ json: { botId: bot, runId } }), signal: AbortSignal.timeout(10000), bypassCustomProtocolHandlers: true,
      });
      if (!response.ok) return false;
      return (await response.json() as { json?: unknown }).json === true;
    });
    tasks.set(JSON.stringify([bot, thread]), { folder, validate });
  });
  return { async taskFolder(botId: string, threadId: string) {
    const task = tasks.get(JSON.stringify([botId, threadId]));
    if (!task) throw new Error("Connect this conversation before starting its preview.");
    await task.validate();
    return task.folder;
  } };
}

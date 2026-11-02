import type { IpcMainInvokeEvent } from "electron";
import { ipcMain } from "electron";
import { ProjectRunner } from "./project-runner.js";

/** Only the trusted chat frame gets process controls. Preview pages have no such bridge. */
export function installProjectRunner(options: {
  storage: string;
  context(
    event: IpcMainInvokeEvent,
    botId: string,
  ): Promise<{ key: string; workspace: string; selected?: string }>;
  leaseValid(): boolean;
}) {
  const runner = new ProjectRunner(options.storage);
  const bot = (value: unknown) => {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value))
      throw new Error("Invalid project agent");
    return value;
  };
  ipcMain.handle("desktop.projectRunner.state", async (event, value: unknown) => {
    const botId = bot(value),
      context = await options.context(event, botId);
    return runner.state(context.key, context.workspace, context.selected);
  });
  ipcMain.handle("desktop.projectRunner.play", async (event, value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("Invalid project run request");
    const request = value as { botId: unknown; profile?: unknown; preparationId?: unknown };
    const botId = bot(request.botId);
    if (
      (request.profile !== undefined &&
        (typeof request.profile !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(request.profile))) ||
      (request.preparationId !== undefined &&
        (typeof request.preparationId !== "string" || request.preparationId.length > 64))
    )
      throw new Error("Invalid project run request");
    const context = await options.context(event, botId);
    const validate = async () => {
      const next = await options.context(event, botId);
      if (
        next.key !== context.key ||
        next.workspace !== context.workspace ||
        next.selected !== context.selected
      )
        throw new Error("The project session changed");
    };
    return runner.play(
      context.key,
      context.workspace,
      context.selected,
      request.profile as string | undefined,
      request.preparationId as string | undefined,
      validate,
    );
  });
  ipcMain.handle("desktop.projectRunner.stop", async (event, value: unknown) => {
    const context = await options.context(event, bot(value));
    return runner.stop(context.key);
  });
  const timer = setInterval(() => {
    if (!options.leaseValid()) runner.dispose();
  }, 1000);
  timer.unref();
  return {
    reset: () => runner.dispose(),
    dispose: () => {
      clearInterval(timer);
      runner.dispose();
    },
  };
}

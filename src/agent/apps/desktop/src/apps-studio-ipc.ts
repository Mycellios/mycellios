import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { AppsStudioRuntime, type StudioScope } from "./apps-studio-runtime.js";
import type { StudioRequest } from "../../../packages/contracts/src/app-studio.js";

export function installAppsStudio(options: {
  userData: string;
  context(event: IpcMainInvokeEvent): Promise<StudioScope>;
}) {
  const runtime = new AppsStudioRuntime(path.join(options.userData, "apps", "video-studio"));
  app.once("before-quit", () => runtime.dispose());
  ipcMain.handle("desktop.apps.studio", async (event, input: StudioRequest) => {
    const scope = await options.context(event);
    const stillAuthorized = async () => {
      try {
        return JSON.stringify(await options.context(event)) === JSON.stringify(scope);
      } catch {
        return false;
      }
    };
    return runtime.request(scope, input, stillAuthorized);
  });
}

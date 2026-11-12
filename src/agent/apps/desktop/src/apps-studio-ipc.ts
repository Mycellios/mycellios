import { VideoEditRuntime, type VideoEditCredits } from "./video-edit-runtime.js";
import { AntseedVideoEditProvider } from "./video-edit-provider.js";
import {managedVideoEditClient,type EditAction} from "./video-edit-wallet.js";
import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { AppsStudioRuntime, type StudioScope } from "./apps-studio-runtime.js";
import type { StudioRequest } from "../../../packages/contracts/src/app-studio.js";

export function installAppsStudio(options: {
  userData: string;
  videoCredits?: VideoEditCredits;
  videoRequest?(event:IpcMainInvokeEvent,scope:StudioScope,action:EditAction,payload:unknown):Promise<unknown>;
  context(event: IpcMainInvokeEvent): Promise<StudioScope>;
}) {
  const runtime = new AppsStudioRuntime(path.join(options.userData, "apps", "video-studio"));
  const videoEdit = new VideoEditRuntime(path.join(options.userData, "apps", "video-edit"), new AntseedVideoEditProvider(), options.videoCredits);
  ipcMain.handle("desktop.apps.video-edit", async (event, input) => {
    const scope = await options.context(event);
    return videoEdit.request(scope, input, async () => {
      try { return JSON.stringify(await options.context(event)) === JSON.stringify(scope); } catch { return false; }
    },options.videoRequest?managedVideoEditClient(scope,(action,payload)=>options.videoRequest!(event,scope,action,payload)):undefined);
  });
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

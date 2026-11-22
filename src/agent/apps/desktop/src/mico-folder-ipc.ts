import type { IpcMainInvokeEvent } from "electron";

type Host = { isEnabled(): boolean; micoFolder(botId: string): string | undefined };

/**
 * Shows and opens a This PC Mico's folder. The renderer names a Mico, never a path: native main
 * resolves that Mico's existing folder itself and returns it only after the current account is
 * confirmed to own the Mico.
 */
export function installMicoFolderIpc(deps: {
  ipcMain: {
    handle(
      channel: string,
      listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ): void;
  };
  /** The configured app's own main frame. */
  trusted(event: IpcMainInvokeEvent): boolean;
  host(): Host | undefined;
  /** Throws unless the current account owns this Mico. */
  owns(event: IpcMainInvokeEvent, botId: string): Promise<unknown>;
  /** Resolves to an error message, or an empty string when the folder opened. */
  open(folder: string): Promise<string>;
}) {
  async function ownedFolder(event: IpcMainInvokeEvent, botId: unknown) {
    const host = deps.host();
    if (
      !deps.trusted(event) ||
      !host?.isEnabled() ||
      typeof botId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,256}$/.test(botId)
    )
      return null;
    const folder = host.micoFolder(botId);
    if (!folder) return null;
    await deps.owns(event, botId);
    return deps.trusted(event) &&
      host === deps.host() &&
      host.isEnabled() &&
      host.micoFolder(botId) === folder
      ? folder
      : null;
  }
  deps.ipcMain.handle("desktop.computer.micoFolder", async (event, botId) => {
    try {
      return await ownedFolder(event, botId);
    } catch {
      return null;
    }
  });
  deps.ipcMain.handle("desktop.computer.openMicoFolder", async (event, botId) => {
    const folder = await ownedFolder(event, botId);
    if (!folder) throw new Error("This Mico has no folder on this PC yet.");
    if (await deps.open(folder)) throw new Error("The folder could not be opened.");
  });
}

import type { IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { installMicoFolderIpc } from "./mico-folder-ipc.js";

const trustedEvent = { trusted: true } as unknown as IpcMainInvokeEvent;
const otherEvent = { trusted: false } as unknown as IpcMainInvokeEvent;

function setup(
  options: { enabled?: boolean; owns?: () => Promise<unknown>; openError?: string } = {},
) {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  const folders = new Map([["mico-1", "/home/user/Mycellios/Micos/Writer"]]);
  const host = {
    isEnabled: () => options.enabled ?? true,
    micoFolder: (botId: string) => folders.get(botId),
  };
  const owns = vi.fn(options.owns ?? (async () => "scope"));
  const open = vi.fn(async () => options.openError ?? "");
  installMicoFolderIpc({
    ipcMain: { handle: (channel, listener) => void handlers.set(channel, listener) },
    trusted: (event) => (event as unknown as { trusted: boolean }).trusted,
    host: () => host,
    owns,
    open,
  });
  const call = (channel: string, event: IpcMainInvokeEvent, botId: unknown) =>
    Promise.resolve(handlers.get(channel)!(event, botId));
  return { call, owns, open, folders };
}

describe("Mico folder IPC", () => {
  it("returns and opens only the owned Mico's existing folder", async () => {
    const { call, owns, open } = setup();
    await expect(call("desktop.computer.micoFolder", trustedEvent, "mico-1")).resolves.toBe(
      "/home/user/Mycellios/Micos/Writer",
    );
    await call("desktop.computer.openMicoFolder", trustedEvent, "mico-1");
    expect(open).toHaveBeenCalledWith("/home/user/Mycellios/Micos/Writer");
    expect(owns).toHaveBeenCalledWith(trustedEvent, "mico-1");
  });

  it("refuses other frames, malformed ids, paths and Micos without a folder", async () => {
    const { call, owns, open } = setup();
    await expect(call("desktop.computer.micoFolder", otherEvent, "mico-1")).resolves.toBeNull();
    for (const botId of ["../mico-1", "/home/user", "C:\\Users", "", 42, "x".repeat(257)])
      await expect(call("desktop.computer.micoFolder", trustedEvent, botId)).resolves.toBeNull();
    await expect(call("desktop.computer.micoFolder", trustedEvent, "mico-2")).resolves.toBeNull();
    await expect(call("desktop.computer.openMicoFolder", otherEvent, "mico-1")).rejects.toThrow();
    expect(owns).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("refuses when access is off or the account does not own the Mico", async () => {
    const off = setup({ enabled: false });
    await expect(
      off.call("desktop.computer.micoFolder", trustedEvent, "mico-1"),
    ).resolves.toBeNull();
    const foreign = setup({
      owns: async () => Promise.reject(new Error("Open this Mico in its Space first.")),
    });
    await expect(
      foreign.call("desktop.computer.micoFolder", trustedEvent, "mico-1"),
    ).resolves.toBeNull();
    await expect(
      foreign.call("desktop.computer.openMicoFolder", trustedEvent, "mico-1"),
    ).rejects.toThrow();
    expect(foreign.open).not.toHaveBeenCalled();
  });

  it("reports a folder the system could not open", async () => {
    const { call } = setup({ openError: "not found" });
    await expect(call("desktop.computer.openMicoFolder", trustedEvent, "mico-1")).rejects.toThrow(
      "The folder could not be opened.",
    );
  });
});

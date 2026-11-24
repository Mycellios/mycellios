import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IpcMainInvokeEvent } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupFolderId, installGroupFolderIpc } from "./group-folder-ipc.js";

const trustedEvent = { trusted: true } as unknown as IpcMainInvokeEvent;
const otherEvent = { trusted: false } as unknown as IpcMainInvokeEvent;
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function setup(
  options: {
    enabled?: boolean;
    scopes?: string[];
    picked?: string | null;
    /** Folder ids the server lists; by default every grant this PC holds. */
    serverFolders?: string[];
  } = {},
) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), "mycellios-group-ipc-")));
  dirs.push(folder);
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  const grants = new Map<string, { folderId: string; name: string; path: string }>();
  const host = {
    isEnabled: () => options.enabled ?? true,
    grantGroupFolder: vi.fn(async (_groupId: string, folderId: string, chosen: string) => {
      const grant = { folderId, name: path.basename(chosen), path: chosen };
      grants.set(folderId, grant);
      return grant;
    }),
    groupFolders: () => [...grants.values()],
    revokeGroupFolder: vi.fn((_groupId: string, folderId: string) => void grants.delete(folderId)),
    pruneGroupFolders: vi.fn((_groupId: string, keep: readonly string[]) => {
      for (const id of [...grants.keys()]) if (!keep.includes(id)) grants.delete(id);
    }),
  };
  const scopes = [...(options.scopes ?? [])];
  const ownsGroup = vi.fn(async () => ({
    scope: scopes.shift() ?? "scope-a",
    folderIds: options.serverFolders ?? [...grants.keys()],
  }));
  const pick = vi.fn(async () => (options.picked === undefined ? folder : options.picked));
  installGroupFolderIpc({
    ipcMain: { handle: (channel, listener) => void handlers.set(channel, listener) },
    trusted: (event) => (event as unknown as { trusted: boolean }).trusted,
    host: () => host,
    ownsGroup,
    pick,
    secret: () => "secret",
  });
  const call = (channel: string, event: IpcMainInvokeEvent, ...args: unknown[]) =>
    Promise.resolve().then(() => handlers.get(channel)!(event, ...args));
  return { folder, call, host, ownsGroup, pick, grants };
}

describe("group folder IPC", () => {
  it("grants the picked folder under an opaque id only after the server confirms the group", async () => {
    const { folder, call, host, ownsGroup } = await setup();
    const chosen = (await call("desktop.computer.chooseGroupFolder", trustedEvent, "group-1")) as {
      folderId: string;
    };
    expect(chosen).toEqual({
      folderId: groupFolderId("secret", "scope-a", "group-1", folder),
      name: path.basename(folder),
      path: folder,
    });
    expect(chosen.folderId).toMatch(/^[a-f0-9]{64}$/);
    expect(ownsGroup).toHaveBeenCalledTimes(2);
    expect(host.grantGroupFolder).toHaveBeenCalledWith("group-1", chosen.folderId, folder);
    await expect(call("desktop.computer.groupFolders", trustedEvent, "group-1")).resolves.toEqual([
      chosen,
    ]);
  });

  it("refuses untrusted frames, disabled access, bad ids and a scope change", async () => {
    const off = await setup({ enabled: false });
    await expect(
      off.call("desktop.computer.chooseGroupFolder", trustedEvent, "group-1"),
    ).rejects.toThrow();
    const { call, host, pick } = await setup({ scopes: ["scope-a", "scope-b"] });
    await expect(
      call("desktop.computer.chooseGroupFolder", otherEvent, "group-1"),
    ).rejects.toThrow();
    await expect(
      call("desktop.computer.chooseGroupFolder", trustedEvent, "../x"),
    ).rejects.toThrow();
    await expect(
      call("desktop.computer.chooseGroupFolder", trustedEvent, "group-1", "nope"),
    ).rejects.toThrow();
    expect(pick).not.toHaveBeenCalled();
    await expect(
      call("desktop.computer.chooseGroupFolder", trustedEvent, "group-1"),
    ).rejects.toThrow("session changed");
    expect(host.grantGroupFolder).not.toHaveBeenCalled();
    await expect(call("desktop.computer.groupFolders", otherEvent, "group-1")).resolves.toEqual([]);
  });

  it("reconnects only the same folder, and a cancelled picker grants nothing", async () => {
    const cancelled = await setup({ picked: null });
    await expect(
      cancelled.call("desktop.computer.chooseGroupFolder", trustedEvent, "group-1"),
    ).resolves.toBeNull();
    expect(cancelled.host.grantGroupFolder).not.toHaveBeenCalled();
    const { folder, call, host } = await setup();
    const expected = groupFolderId("secret", "scope-a", "group-1", folder);
    await expect(
      call("desktop.computer.chooseGroupFolder", trustedEvent, "group-1", "a".repeat(64)),
    ).rejects.toThrow("same folder");
    await expect(
      call("desktop.computer.chooseGroupFolder", trustedEvent, "group-1", expected),
    ).resolves.toMatchObject({
      folderId: expected,
    });
    expect(host.grantGroupFolder).toHaveBeenCalledTimes(1);
  });

  it("hides grants made for another account or Space, and removes a grant on request", async () => {
    const { call, host } = await setup({ scopes: ["scope-a", "scope-a", "scope-b"] });
    const chosen = (await call("desktop.computer.chooseGroupFolder", trustedEvent, "group-1")) as {
      folderId: string;
    };
    await expect(call("desktop.computer.groupFolders", trustedEvent, "group-1")).resolves.toEqual(
      [],
    );
    await expect(
      call("desktop.computer.removeGroupFolder", otherEvent, "group-1", chosen.folderId),
    ).rejects.toThrow();
    await call("desktop.computer.removeGroupFolder", trustedEvent, "group-1", chosen.folderId);
    expect(host.revokeGroupFolder).toHaveBeenCalledWith("group-1", chosen.folderId);
  });

  it("withdraws grants of folders removed on another device, so they stop counting", async () => {
    const serverFolders: string[] = [];
    const { call, host, grants } = await setup({ serverFolders });
    const first = (await call("desktop.computer.chooseGroupFolder", trustedEvent, "group-1")) as {
      folderId: string;
    };
    // The server keeps it, so listing leaves it granted.
    serverFolders.push(first.folderId);
    await expect(
      call("desktop.computer.groupFolders", trustedEvent, "group-1"),
    ).resolves.toHaveLength(1);
    // Removed from the web: the next listing on this PC withdraws the grant.
    serverFolders.length = 0;
    await expect(call("desktop.computer.groupFolders", trustedEvent, "group-1")).resolves.toEqual(
      [],
    );
    expect(host.pruneGroupFolders).toHaveBeenLastCalledWith("group-1", []);
    expect(grants.size).toBe(0);
    // Adding a folder also prunes first, then grants the new one.
    grants.set("b".repeat(64), { folderId: "b".repeat(64), name: "orphan", path: "/orphan" });
    await call("desktop.computer.chooseGroupFolder", trustedEvent, "group-1");
    expect([...grants.keys()]).toEqual([first.folderId]);
  });
});

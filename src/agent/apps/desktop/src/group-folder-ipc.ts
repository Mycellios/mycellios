import { createHmac } from "node:crypto";
import { realpath } from "node:fs/promises";
import type { IpcMainInvokeEvent } from "electron";

type Grant = { folderId: string; name: string; path: string };
type Host = {
  isEnabled(): boolean;
  grantGroupFolder(groupId: string, folderId: string, folder: string): Promise<Grant>;
  groupFolders(groupId: string): Grant[];
  revokeGroupFolder(groupId: string, folderId: string): void;
  pruneGroupFolders(groupId: string, keep: readonly string[]): void;
};
/** What the server says about the group: the caller's scope and the folder ids it keeps. */
type OwnedGroup = { scope: string; folderIds: string[] };

const GROUP_ID = /^[a-zA-Z0-9_-]{1,256}$/;
const FOLDER_ID = /^[a-f0-9]{64}$/;

/**
 * Opaque id of a folder granted to a group, stable across sessions on this PC. It reveals
 * nothing about the path to the server; the path itself is shown to the owner's own renderer
 * and to the members' runs (their environment), as the spec documents.
 */
export function groupFolderId(secret: string, scope: string, groupId: string, folder: string) {
  return createHmac("sha256", secret)
    .update(JSON.stringify(["group-folder", scope, groupId, folder]))
    .digest("hex");
}

/**
 * Group shared folders on this PC (specs/group-shared-folders/spec.md). The renderer names a
 * group, never a path: only the native folder picker chooses a folder, and only after the
 * server confirms that the signed-in account owns the group in the selected Space.
 */
export function installGroupFolderIpc(deps: {
  ipcMain: {
    handle(
      channel: string,
      listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ): void;
  };
  /** The configured app's own main frame. */
  trusted(event: IpcMainInvokeEvent): boolean;
  host(): Host | undefined;
  /** Throws unless the current account owns this group; resolves to its scope and folder ids. */
  ownsGroup(event: IpcMainInvokeEvent, groupId: string): Promise<OwnedGroup>;
  /** The native folder picker; null when cancelled. */
  pick(): Promise<string | null>;
  /** This PC's private, persisted key for folder ids. */
  secret(): string;
}) {
  // Which account/Space scope granted each folder, so another scope never sees it.
  const scopes = new Map<string, string>();
  const key = (groupId: string, folderId: string) => JSON.stringify([groupId, folderId]);
  /**
   * Grants of folders the server no longer has (removed from another device) are withdrawn, so
   * they stay unreachable and stop counting toward this PC's limit. Only the group's owner gets
   * the server's list, so another account cannot prune them.
   */
  function prune(host: Host, groupId: string, owned: OwnedGroup) {
    host.pruneGroupFolders(groupId, owned.folderIds);
  }

  deps.ipcMain.handle("desktop.computer.chooseGroupFolder", async (event, groupId, expected) => {
    const host = deps.host();
    if (
      !deps.trusted(event) ||
      !host?.isEnabled() ||
      typeof groupId !== "string" ||
      !GROUP_ID.test(groupId) ||
      (expected !== undefined && (typeof expected !== "string" || !FOLDER_ID.test(expected)))
    )
      throw new Error("Allow access to this PC first.");
    const owned = await deps.ownsGroup(event, groupId);
    const picked = await deps.pick();
    if (!picked) return null;
    const folder = await realpath(picked);
    const folderId = groupFolderId(deps.secret(), owned.scope, groupId, folder);
    if (expected !== undefined && folderId !== expected)
      throw new Error("Choose the same folder as before.");
    const current = await deps.ownsGroup(event, groupId);
    if (
      !deps.trusted(event) ||
      host !== deps.host() ||
      !host.isEnabled() ||
      current.scope !== owned.scope
    )
      throw new Error("The application session changed.");
    prune(host, groupId, current);
    const grant = await host.grantGroupFolder(groupId, folderId, folder);
    scopes.set(key(groupId, folderId), owned.scope);
    return { folderId: grant.folderId, name: grant.name, path: grant.path };
  });

  deps.ipcMain.handle("desktop.computer.groupFolders", async (event, groupId) => {
    try {
      const host = deps.host();
      if (
        !deps.trusted(event) ||
        !host?.isEnabled() ||
        typeof groupId !== "string" ||
        !GROUP_ID.test(groupId)
      )
        return [];
      const owned = await deps.ownsGroup(event, groupId);
      prune(host, groupId, owned);
      return host
        .groupFolders(groupId)
        .filter((grant) => scopes.get(key(groupId, grant.folderId)) === owned.scope)
        .map(({ folderId, name, path }) => ({ folderId, name, path }));
    } catch {
      return [];
    }
  });

  // Withdrawing a grant is always safe, so it needs no server round trip.
  deps.ipcMain.handle("desktop.computer.removeGroupFolder", (event, groupId, folderId) => {
    if (
      !deps.trusted(event) ||
      typeof groupId !== "string" ||
      !GROUP_ID.test(groupId) ||
      typeof folderId !== "string" ||
      !FOLDER_ID.test(folderId)
    )
      throw new Error("Invalid folder.");
    deps.host()?.revokeGroupFolder(groupId, folderId);
    scopes.delete(key(groupId, folderId));
  });
}

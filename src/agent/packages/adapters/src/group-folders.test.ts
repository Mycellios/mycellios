import { describe, expect, it, vi } from "vitest";
import {
  groupFolderInstruction,
  groupFoldersForRun,
  isGroupFolderPath,
  refreshGroupFolders,
} from "./group-folders.js";

const run = { groupId: "group-1", botId: "ana", userId: "owner", spaceId: "space" };
const site = { folderId: "a".repeat(64), name: "site" };
const notes = { folderId: "b".repeat(64), name: "notes" };

function prisma(folders: Array<{ folderId: string; name: string }> | null) {
  return { chatGroup: { findFirst: vi.fn(async () => (folders ? { folders } : null)) } } as never;
}

describe("group shared folders in a run", () => {
  it("carries the folder ids only for a This PC member's turn, scoped to owner, Space and membership", async () => {
    const db = prisma([site, notes]);
    const onPc = await groupFoldersForRun(db, run, { kind: "desktop", mode: "dedicated" });
    expect(onPc.context).toEqual({
      groupId: "group-1",
      folderIds: [site.folderId, notes.folderId],
    });
    const where = (db as { chatGroup: { findFirst: ReturnType<typeof vi.fn> } }).chatGroup.findFirst
      .mock.calls[0]![0].where;
    expect(where).toMatchObject({
      id: "group-1",
      userId: "owner",
      spaceId: "space",
      archivedAt: null,
      members: { some: { botId: "ana", bot: { archivedAt: null } } },
    });
    for (const computer of [
      { kind: "docker", mode: "isolated" },
      { kind: "docker", mode: "team" },
      { kind: "desktop", mode: "team" },
      { kind: "desktop", mode: "isolated" },
    ]) {
      const away = await groupFoldersForRun(prisma([site]), run, computer);
      expect(away).toEqual({ folders: [site], context: undefined });
    }
    // A project task conversation keeps its own worktree binding only.
    expect(
      await groupFoldersForRun(prisma([site]), run, {
        kind: "desktop",
        mode: "dedicated",
        projectSessionId: "t",
      }),
    ).toEqual({ folders: [], context: undefined });
    // Not a member (or another owner's group): nothing.
    expect(
      await groupFoldersForRun(prisma(null), run, { kind: "desktop", mode: "dedicated" }),
    ).toEqual({
      folders: [],
      context: undefined,
    });
  });

  it("drops removed folders and departed members before the next tool call", async () => {
    const context = {
      groupFolders: { groupId: "group-1", folderIds: [site.folderId, notes.folderId] },
    };
    const shared = context.groupFolders;
    await refreshGroupFolders(prisma([notes]), run, context);
    expect(shared.folderIds).toEqual([notes.folderId]);
    await refreshGroupFolders(prisma(null), run, context);
    expect(shared.folderIds).toEqual([]);
    const none = {};
    await refreshGroupFolders(prisma([site]), run, none);
    expect(none).toEqual({});
    shared.folderIds = [site.folderId];
    const failing = {
      chatGroup: { findFirst: vi.fn(async () => Promise.reject(new Error("db down"))) },
    } as never;
    await refreshGroupFolders(failing, run, context);
    expect(shared.folderIds).toEqual([]);
    expect(await groupFoldersForRun(failing, run, { kind: "desktop", mode: "dedicated" })).toEqual({
      folders: [],
      context: undefined,
    });
  });

  it("tells a member which folders it can use here and which it cannot reach", () => {
    expect(groupFolderInstruction([], [])).toBeUndefined();
    const text = groupFolderInstruction(
      [site, notes],
      [{ folderId: site.folderId, label: "site", path: "/home/owner/site" }],
    )!;
    expect(text).toContain('group/site ("/home/owner/site")');
    expect(text).toContain("edit_file");
    expect(text).toContain('cannot reach from its computer: "notes"');
    const away = groupFolderInstruction([site], [])!;
    expect(away).not.toContain("group/site");
    expect(away).toContain('"site"');
  });

  it("recognizes shared folder paths", () => {
    expect(isGroupFolderPath("group/site/index.html")).toBe(true);
    expect(isGroupFolderPath("/group/site")).toBe(true);
    expect(isGroupFolderPath("group\\site\\a.txt")).toBe(true);
    expect(isGroupFolderPath("group")).toBe(false);
    expect(isGroupFolderPath("groups/site")).toBe(false);
    expect(isGroupFolderPath("project/group/x")).toBe(false);
  });
});

import { GroupFolderLabel, groupFolderLabel } from "@mycellios/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  groupFolderInstruction,
  groupFoldersForRun,
  isGroupFolderPath,
  personStartedGroupTurn,
  refreshGroupFolders,
} from "./group-folders.js";

const run = { groupId: "group-1", botId: "ana", userId: "owner", spaceId: "space" };
const site = { folderId: "a".repeat(64), name: "site", label: "site" };
const notes = { folderId: "b".repeat(64), name: "notes", label: "notes" };
const personTurn = { threadId: "group-thread", trigger: "user", sourceMessageId: "m1" };
const onPcComputer = { kind: "desktop", mode: "dedicated" };

type Message = { threadId: string; role: string; runId: string | null };
type Run = {
  threadId: string;
  trigger: string;
  routineId: string | null;
  sourceMessageId: string | null;
};

function prisma(
  folders: Array<{ folderId: string; name: string; label: string }> | null,
  history: { messages?: Record<string, Message>; runs?: Record<string, Run> } = {},
) {
  return {
    chatGroup: { findFirst: vi.fn(async () => (folders ? { folders } : null)) },
    message: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => history.messages?.[where.id] ?? null,
      ),
    },
    run: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => history.runs?.[where.id] ?? null,
      ),
    },
  } as never;
}

describe("group shared folders in a run", () => {
  it("carries the folders only for a This PC member's turn, scoped to owner, Space and membership", async () => {
    const db = prisma([site, notes]);
    const onPc = await groupFoldersForRun(db, run, onPcComputer, personTurn);
    expect(onPc.context).toEqual({
      groupId: "group-1",
      folders: [
        { folderId: site.folderId, label: "site" },
        { folderId: notes.folderId, label: "notes" },
      ],
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
      const away = await groupFoldersForRun(prisma([site]), run, computer, personTurn);
      expect(away).toEqual({ folders: [site], context: undefined });
    }
    const none = { folders: [], context: undefined };
    // A project task conversation keeps its own worktree binding only.
    expect(
      await groupFoldersForRun(
        prisma([site]),
        run,
        { ...onPcComputer, projectSessionId: "t" },
        personTurn,
      ),
    ).toEqual(none);
    // Not a member (or another owner's group): nothing.
    expect(await groupFoldersForRun(prisma(null), run, onPcComputer, personTurn)).toEqual(none);
  });

  it("never gives the folders to routines, webhooks, channels, Mico requests or background work", async () => {
    const none = { folders: [], context: undefined };
    for (const turn of [
      { threadId: "group-thread", trigger: "routine", routineId: "r1" },
      { threadId: "group-thread", trigger: "user", routineId: "r1" },
      { threadId: "group-thread", trigger: "webhook" },
      { threadId: "group-thread", trigger: "messaging" },
      { threadId: "group-thread", trigger: "bot_message" },
      { threadId: "group-thread", trigger: "delegated_task" },
      { threadId: "group-thread", trigger: "agent_task" },
      { threadId: "group-thread", trigger: "tickets" },
      { threadId: "group-thread", trigger: "project_prepare" },
      { threadId: "group-thread", trigger: "spawn" },
    ])
      expect(await groupFoldersForRun(prisma([site]), run, onPcComputer, turn)).toEqual(none);
    expect(
      await groupFoldersForRun(prisma([site]), run, onPcComputer, {
        ...personTurn,
        messagingChannel: true,
      }),
    ).toEqual(none);
  });

  it("follows group handoffs back to the person, never to a routine or another thread", async () => {
    const thread = "group-thread";
    const handoff = { threadId: thread, trigger: "follow_up", sourceMessageId: "handoff" };
    const history = (lead: Run, message: Partial<Message> = {}) =>
      prisma([site], {
        messages: { handoff: { threadId: thread, role: "bot", runId: "lead", ...message } },
        runs: { lead },
      });
    const lead: Run = { threadId: thread, trigger: "user", routineId: null, sourceMessageId: "m1" };
    expect(await personStartedGroupTurn(history(lead), handoff)).toBe(true);
    // A follow-up of the person's own message.
    const own = prisma([site], {
      messages: { handoff: { threadId: thread, role: "user", runId: null } },
    });
    expect(await personStartedGroupTurn(own, handoff)).toBe(true);
    // The lead's turn came from a routine.
    expect(
      await personStartedGroupTurn(
        history({ threadId: thread, trigger: "routine", routineId: "r1", sourceMessageId: null }),
        handoff,
      ),
    ).toBe(false);
    expect(
      await personStartedGroupTurn(
        history({ threadId: thread, trigger: "user", routineId: "r1", sourceMessageId: null }),
        handoff,
      ),
    ).toBe(false);
    // A brief sent into the group from a Mico's own chat (send_to_group) names no run.
    expect(await personStartedGroupTurn(history(lead, { runId: null }), handoff)).toBe(false);
    // Another thread's message or run.
    expect(
      await personStartedGroupTurn(
        history(
          { threadId: thread, trigger: "user", routineId: null, sourceMessageId: null },
          { threadId: "x" },
        ),
        handoff,
      ),
    ).toBe(false);
    expect(
      await personStartedGroupTurn(
        history({ threadId: "x", trigger: "user", routineId: null, sourceMessageId: null }),
        handoff,
      ),
    ).toBe(false);
    // A cycle never grants access.
    const loop = prisma([site], {
      messages: { handoff: { threadId: thread, role: "bot", runId: "lead" } },
      runs: {
        lead: {
          threadId: thread,
          trigger: "follow_up",
          routineId: null,
          sourceMessageId: "handoff",
        },
      },
    });
    expect(await personStartedGroupTurn(loop, handoff)).toBe(false);
    // A failed read never grants access.
    const failing = {
      message: { findUnique: vi.fn(async () => Promise.reject(new Error("db"))) },
    } as never;
    expect(await personStartedGroupTurn(failing, handoff)).toBe(false);
  });

  it("drops removed folders and departed members before the next tool call", async () => {
    const context = {
      groupFolders: {
        groupId: "group-1",
        folders: [
          { folderId: site.folderId, label: "site" },
          { folderId: notes.folderId, label: "notes" },
        ],
      },
    };
    const shared = context.groupFolders;
    await refreshGroupFolders(prisma([notes]), run, context);
    expect(shared.folders).toEqual([{ folderId: notes.folderId, label: "notes" }]);
    await refreshGroupFolders(prisma(null), run, context);
    expect(shared.folders).toEqual([]);
    const none = {};
    await refreshGroupFolders(prisma([site]), run, none);
    expect(none).toEqual({});
    shared.folders = [{ folderId: site.folderId, label: "site" }];
    const failing = {
      chatGroup: { findFirst: vi.fn(async () => Promise.reject(new Error("db down"))) },
      message: { findUnique: vi.fn() },
      run: { findUnique: vi.fn() },
    } as never;
    await refreshGroupFolders(failing, run, context);
    expect(shared.folders).toEqual([]);
    expect(await groupFoldersForRun(failing, run, onPcComputer, personTurn)).toEqual({
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

  it("labels each folder once, as a safe path segment the PC accepts", () => {
    expect(groupFolderLabel("site", [])).toBe("site");
    expect(groupFolderLabel("Site", ["site"])).toBe("Site 2");
    expect(groupFolderLabel("site", ["site", "Site 2"])).toBe("site 3");
    expect(groupFolderLabel("a/b:c", [])).toBe("a-b-c");
    expect(groupFolderLabel("...", [])).toBe("folder");
    for (const label of [
      "site",
      "Site 2",
      "a-b-c",
      "folder",
      groupFolderLabel("x".repeat(200), []),
    ])
      expect(GroupFolderLabel.safeParse(label).success).toBe(true);
    for (const label of ["", ".", "..", "a/b", "a\\b", " a", "a.", "x".repeat(73)])
      expect(GroupFolderLabel.safeParse(label).success).toBe(false);
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

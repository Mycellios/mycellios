import type { MessageBlock } from "@mycellios/contracts";
import { describe, expect, it } from "vitest";
import { blocksToAgentHistoryText } from "./attachments.js";
import {
  BRANCH_HANDOFF_NOTE,
  BRANCH_ORIGIN_HISTORY_TEXT,
  BRANCH_TITLE_FALLBACK,
  blockArtifactIds,
  branchConversationTitle,
  branchThreadKey,
  isBranchFileNonce,
  numberedBranchTitle,
  withCopiedArtifacts,
} from "./conversation-branch.js";
import { isMicoTaskThread, taskThreadKind } from "./work-resources.js";

const title = (input: Partial<Parameters<typeof branchConversationTitle>[0]>) =>
  branchConversationTitle({
    sourceTitle: "Trip budget",
    sourceIsMainChat: false,
    sourceIsBranch: false,
    existingTitles: [],
    lastUserBlocks: null,
    ...input,
  });

describe("branch titles", () => {
  it("counts up from #2 across the branches a source already has", () => {
    expect(title({})).toBe("Trip budget #2");
    expect(
      title({ existingTitles: ["Trip budget #2", "Trip budget #7", "Trip budget notes"] }),
    ).toBe("Trip budget #8");
  });

  it("keeps counting on the family when a branch is branched again", () => {
    expect(
      title({
        sourceTitle: "Trip budget #2",
        sourceIsBranch: true,
        existingTitles: ["Trip budget #2", "Trip budget #3"],
      }),
    ).toBe("Trip budget #4");
    // A person's title that only looks numbered keeps its number when it is not a branch.
    expect(title({ sourceTitle: "Release #5" })).toBe("Release #5 #2");
  });

  it("names a main-chat branch after the person's last message, else a fixed title", () => {
    const blocks: MessageBlock[] = [
      { kind: "text", text: "\n  And the hotels?\nNear the station" },
    ];
    expect(title({ sourceIsMainChat: true, lastUserBlocks: blocks })).toBe("And the hotels?");
    expect(title({ sourceIsMainChat: true })).toBe(BRANCH_TITLE_FALLBACK);
    expect(title({ sourceTitle: "  ", lastUserBlocks: blocks })).toBe("And the hotels?");
  });

  it("cuts a long source title but never the number", () => {
    const long = numberedBranchTitle("🍄".repeat(130), 12);
    expect(Array.from(long)).toHaveLength(120);
    expect(long.endsWith("… #12")).toBe(true);
  });
});

describe("branch identity and files", () => {
  it("is an ordinary conversation of the Mico, keyed by the request", () => {
    const thread = {
      taskBotId: "mico",
      projectKey: "mico:mico",
      taskKey: branchThreadKey("mico", "request"),
    };
    expect(thread.taskKey).toBe("mico-task:mico:branch:request");
    expect(isMicoTaskThread(thread)).toBe(true);
    expect(taskThreadKind(thread)).toBe("conversation");
  });

  it("finds the artifacts a message shows and points them at their copies", () => {
    const blocks: MessageBlock[] = [
      { kind: "text", text: "Here" },
      { kind: "file", artifactId: "a", mimeType: "text/csv", name: "a.csv", size: 3 },
      { kind: "image", artifactId: "b", mimeType: "image/png", name: "b.png" },
      { kind: "image_generation", status: "completed", aspectRatio: "1:1", artifactId: "b" },
      { kind: "image_generation", status: "generating", aspectRatio: "1:1" },
    ];
    expect(blockArtifactIds(blocks)).toEqual(["a", "b", "b"]);
    const copied = withCopiedArtifacts(
      blocks,
      new Map([
        ["a", "a2"],
        ["b", "b2"],
      ]),
    );
    expect(blockArtifactIds(copied)).toEqual(["a2", "b2", "b2"]);
    expect(blockArtifactIds(withCopiedArtifacts(blocks, new Map()))).toEqual(["a", "b", "b"]);
    expect(isBranchFileNonce("branch-copy:thread:a")).toBe(true);
    expect(isBranchFileNonce("upload-1")).toBe(false);
  });
});

describe("what the model reads", () => {
  it("marks where the copied history ends and says files were not rolled back", () => {
    const text = blocksToAgentHistoryText([
      { kind: "branch_origin", threadId: "t", messageId: "m", title: "Trip budget" },
    ]);
    expect(text).toBe(BRANCH_ORIGIN_HISTORY_TEXT);
    expect(text).toMatch(/copied/);
    expect(text).not.toContain("Trip budget");
    expect(BRANCH_HANDOFF_NOTE).toMatch(/not rolled back/);
    expect(BRANCH_HANDOFF_NOTE).toMatch(/read a file again/);
  });
});

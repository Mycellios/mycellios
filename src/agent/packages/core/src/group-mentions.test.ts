import { describe, expect, it } from "vitest";
import {
  addressedGroupBotIds,
  groupContinuePrompt,
  groupLeadBotId,
  hasMentionToken,
  inferHandoffTargetBotId,
  inferHandoffTargetName,
  isContinueRequest,
  resolveGroupTargetBotIds,
} from "./group-mentions.js";

const members = [
  { id: "a", name: "BotA" },
  { id: "b", name: "BotB" },
  { id: "c", name: "Writer" },
];

describe("hasMentionToken", () => {
  it("requires a boundary after the complete member name", () => {
    expect(hasMentionToken("Ask @Ann to review", "Ann")).toBe(true);
    expect(hasMentionToken("Ask @Ann, then continue", "Ann")).toBe(true);
    expect(hasMentionToken("Ask @Anna to review", "Ann")).toBe(false);
    expect(hasMentionToken("name@Ann", "Ann")).toBe(false);
    expect(hasMentionToken("contact@everyone", "everyone")).toBe(false);
  });

  it("supports multi-word and Unicode member names", () => {
    expect(hasMentionToken("Ask @Research Writer and @Éditeur", "Research Writer")).toBe(true);
    expect(hasMentionToken("Ask @Research Writer and @Éditeur", "Éditeur")).toBe(true);
  });
});

describe("resolveGroupTargetBotIds", () => {
  it("returns mentioned bots from text", () => {
    expect(
      resolveGroupTargetBotIds({
        text: "@BotA gather sources. @BotB summarize.",
        members,
      }),
    ).toEqual(["a", "b"]);
  });

  it("returns all members for @everyone", () => {
    expect(
      resolveGroupTargetBotIds({
        text: "@everyone please review",
        members,
      }),
    ).toEqual(["a", "b", "c"]);
  });

  it("merges explicit mentions", () => {
    expect(
      resolveGroupTargetBotIds({
        text: "hello",
        members,
        explicitMentions: ["b"],
      }),
    ).toEqual(["b"]);
  });

  it("matches multi-word and Unicode names without prefix collisions", () => {
    const namedMembers = [
      { id: "research", name: "Research Writer" },
      { id: "edit", name: "Éditeur" },
      { id: "ann", name: "Ann" },
      { id: "anna", name: "Anna" },
    ];
    expect(
      resolveGroupTargetBotIds({
        text: "@Research Writer compare this with @Éditeur and @Anna.",
        members: namedMembers,
      }),
    ).toEqual(["research", "edit", "anna"]);
  });

  it("ignores explicit mentions for bots that are not group members", () => {
    expect(
      resolveGroupTargetBotIds({
        text: "hello",
        members,
        explicitMentions: ["b", "outsider"],
      }),
    ).toEqual(["b"]);
  });

  it("picks the first member when unmentioned", () => {
    expect(
      resolveGroupTargetBotIds({
        text: "hello team",
        members,
      }),
    ).toEqual(["a"]);
  });
});

describe("inferHandoffTargetName", () => {
  it("picks Writer when BotA is also mentioned", () => {
    expect(inferHandoffTargetName("@BotA hand this to Writer for the draft")).toBe("Writer");
  });
});

describe("inferHandoffTargetBotId", () => {
  it("recognizes hand this to Writer", () => {
    expect(inferHandoffTargetBotId("hand this to Writer for the draft", members)).toBe("c");
  });

  it("recognizes @Writer take the draft", () => {
    expect(inferHandoffTargetBotId("@Writer take the draft", members)).toBe("c");
  });

  it("resolves Writer from mixed mention prompt", () => {
    expect(inferHandoffTargetBotId("@BotA hand this to Writer for the draft", members)).toBe("c");
  });

  it("resolves multi-word handoff targets", () => {
    expect(
      inferHandoffTargetBotId("hand this to Research Writer for the draft", [
        ...members,
        { id: "research", name: "Research Writer" },
      ]),
    ).toBe("research");
  });
});

describe("group lead routing", () => {
  it("sends a message that names nobody to the chosen lead", () => {
    expect(resolveGroupTargetBotIds({ text: "plan the launch", members, leadBotId: "c" })).toEqual(["c"]);
  });

  it("keeps explicit mentions ahead of the lead", () => {
    expect(resolveGroupTargetBotIds({ text: "@BotB plan it", members, leadBotId: "c" })).toEqual(["b"]);
    expect(resolveGroupTargetBotIds({ text: "plan it", members, explicitMentions: ["a"], leadBotId: "c" })).toEqual([
      "a",
    ]);
  });

  it("treats a message that opens with a member's name as addressed to it", () => {
    expect(resolveGroupTargetBotIds({ text: "Writer, draft the intro", members, leadBotId: "a" })).toEqual(["c"]);
    expect(resolveGroupTargetBotIds({ text: "writer: draft the intro", members, leadBotId: "a" })).toEqual(["c"]);
    expect(addressedGroupBotIds({ text: "The writer drafts later", members })).toEqual([]);
  });

  it("falls back to the first member when the lead left the group", () => {
    expect(groupLeadBotId(members, "gone")).toBe("a");
    expect(groupLeadBotId(members, null)).toBe("a");
    expect(groupLeadBotId([], "a")).toBeUndefined();
  });
});

describe("continue requests", () => {
  it("recognises short requests to go on", () => {
    for (const text of ["continue", "Keep going!", "  go on ", "Sigue", "continúa, por favor", "resume."]) {
      expect(isContinueRequest(text)).toBe(true);
    }
  });

  it("leaves real requests alone", () => {
    for (const text of ["", "continue with the second chapter and add charts", "go on holiday", "stop"]) {
      expect(isContinueRequest(text)).toBe(false);
    }
  });

  it("repeats the earlier request and asks not to start over", () => {
    const prompt = groupContinuePrompt("Write the Q3 summary");
    expect(prompt).toContain("<earlier_request>\nWrite the Q3 summary\n</earlier_request>");
    expect(prompt).toContain("do not start over");
    expect(groupContinuePrompt("")).not.toContain("<earlier_request>");
  });
});

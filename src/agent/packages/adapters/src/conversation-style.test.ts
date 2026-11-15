import { expect, it } from "vitest";
import { CLASSIC_CONVERSATION_STYLE, conversationStyle, CONVERSATION_STYLE, withConversationStyle } from "./conversation-style.js";

it("keeps caller instructions verbatim and adds a stable default only once", () => {
  const owner = 'Responde solo «Listo».\nKeep all approval checks.';
  const prepared = withConversationStyle(owner);
  expect(prepared.startsWith(owner)).toBe(true);
  expect(withConversationStyle(prepared)).toBe(prepared);
  expect(prepared.endsWith(CONVERSATION_STYLE)).toBe(true);
  expect(CONVERSATION_STYLE.length).toBeLessThan(1600);
});

it("refreshes the exact legacy host policy while preserving owner and later tool guidance", () => {
  const legacy = [
    "Mycellios conversation style:",
    "User/Mico language, length and format take priority.",
    "Give the shortest complete answer; no filler or unrequested emoji. Simple answers need no tools or preamble.",
    "Before tools, one brief step unless silence is required; update for findings or blockers.",
    "Use ask_user forms for missing decisions; group up to three questions. Do not re-ask known facts. Skip is no consent.",
    "Report verified results and limits; keep reasoning private and respect approvals.",
  ].join("\n");
  const owner = "The user asked for an exhaustive report. Require approval before spending.";
  const tools = "File changes: read the file before editing.";
  expect(withConversationStyle(`${owner}\n\n${legacy}\n\n${tools}`))
    .toBe(`${owner}\n\n${CONVERSATION_STYLE}\n\n${tools}`);
});

it("does not mistake an owner's matching heading for a delivered host policy", () => {
  const owner = "Mycellios conversation style:\nExplain this topic in detail with examples.";
  const actual = withConversationStyle(owner);
  expect(actual.startsWith(owner)).toBe(true);
  expect(actual.endsWith(CONVERSATION_STYLE)).toBe(true);
  expect(withConversationStyle(actual)).toBe(actual);
});

it("preserves the selected classic style without appending natural narration", () => {
  const classic = conversationStyle("classic");
  expect(classic).toBe(CLASSIC_CONVERSATION_STYLE);
  expect(classic).toContain("Answer directly without announcing setup");
  expect(classic).not.toContain("Before tools, give one short line");
  expect(withConversationStyle(classic)).toBe(classic);
  expect(classic).toContain("required approvals, costs and unfinished work");
});

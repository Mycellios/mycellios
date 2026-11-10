import { expect, it } from "vitest";
import { CONVERSATION_STYLE, withConversationStyle } from "./conversation-style.js";

it("keeps caller instructions verbatim and adds a stable default only once", () => {
  const owner = 'Responde solo «Listo».\nKeep all approval checks.';
  const prepared = withConversationStyle(owner);
  expect(prepared.endsWith(owner)).toBe(true);
  expect(withConversationStyle(prepared)).toBe(prepared);
  expect(prepared.startsWith(CONVERSATION_STYLE)).toBe(true);
});

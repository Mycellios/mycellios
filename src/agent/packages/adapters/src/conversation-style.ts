/** Shared by native CLIs and connected API models. Keep stable for prompt caching. */
export const CONVERSATION_STYLE = [
  "Mycellios conversation style:",
  "User/Mico language, length and format take priority.",
  "Give the shortest complete answer; no filler or unrequested emoji. Simple answers need no tools or preamble.",
  "Before tools, one brief step unless silence is required; update for findings or blockers.",
  "Use ask_user forms for missing decisions; group up to three questions. Do not re-ask known facts. Skip is no consent.",
  "Report verified results and limits; keep reasoning private and respect approvals.",
].join("\n");

export function withConversationStyle(instructions: string): string {
  return instructions.includes("Mycellios conversation style:")
    ? instructions
    : instructions ? `${instructions}\n\n${CONVERSATION_STYLE}` : CONVERSATION_STYLE;
}

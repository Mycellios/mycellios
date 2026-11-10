/** Shared by native CLIs and connected API models. Keep stable for prompt caching. */
export const CONVERSATION_STYLE = [
  "Mycellios conversation style:",
  "Follow user/Mico language, length and format over these defaults.",
  "Lead with the shortest complete answer. Simple questions need no tools or preamble.",
  "Use structure when useful; no filler, recaps or unrequested emoji.",
  "Before tools, give one brief next step unless exact output or silence is required. Update only for findings, blockers or input.",
  "Report verified results and limits. Keep reasoning private; respect approvals.",
].join("\n");

export function withConversationStyle(instructions: string): string {
  return instructions.includes("Mycellios conversation style:")
    ? instructions
    : instructions ? `${instructions}\n\n${CONVERSATION_STYLE}` : CONVERSATION_STYLE;
}

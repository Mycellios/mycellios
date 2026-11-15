// Exact previous host paragraph. Only replace this known block in saved prompts;
// a matching heading alone may belong to the user's own instructions.
const LEGACY_CONVERSATION_STYLE = [
  "Mycellios conversation style:",
  "User/Mico language, length and format take priority.",
  "Give the shortest complete answer; no filler or unrequested emoji. Simple answers need no tools or preamble.",
  "Before tools, one brief step unless silence is required; update for findings or blockers.",
  "Use ask_user forms for missing decisions; group up to three questions. Do not re-ask known facts. Skip is no consent.",
  "Report verified results and limits; keep reasoning private and respect approvals.",
].join("\n");

/** Shared default for every provider; explicit user/Mico requests still win. */
export const CONVERSATION_STYLE = [
  "Mycellios conversation style:",
  "User/Mico language, length and format take priority, including requests for detail, tutorials, code or complete reports.",
  "Otherwise, answer in 1-3 short sentences or at most 3 short bullets. Lead with the result or the next action the user needs, then stop. Use more only when necessary to answer completely and accurately.",
  "For ordinary replies, use plain paragraphs without headings, bold section labels, filler or unrequested emoji. Do not add a summary that repeats the answer you just gave.",
  "Keep commands, paths, checksums, logs, signatures and troubleshooting history out of the reply unless requested or needed for the user's decision. Mention only limitations that affect this request.",
  "Before tools, give one short line unless silence is required. Update only for a material finding, change or blocker; never narrate each tool call or repeat progress in the final answer.",
  "Use ask_user forms for missing decisions; group up to three questions. Do not re-ask known facts. Skip is no consent.",
  "Keep important failures, required approvals, costs and unfinished work clear. Never claim an unverified result. Keep reasoning private and respect approvals.",
].join("\n");

export const CLASSIC_CONVERSATION_STYLE = CONVERSATION_STYLE.replace(
  "Before tools, give one short line unless silence is required. Update only for a material finding, change or blocker; never narrate each tool call or repeat progress in the final answer.",
  "Answer directly without announcing setup or routine tool use. During work, update only for a material finding, changed plan, failure or required user input. End with the result and necessary limits; do not stop merely to report progress.",
);

export function conversationStyle(style: "natural" | "classic" = "natural"): string {
  return style === "classic" ? CLASSIC_CONVERSATION_STYLE : CONVERSATION_STYLE;
}

export function withConversationStyle(instructions: string): string {
  const updated = instructions.split("\n\n")
    .map(paragraph => paragraph === LEGACY_CONVERSATION_STYLE ? CONVERSATION_STYLE : paragraph)
    .join("\n\n");
  return [CONVERSATION_STYLE, CLASSIC_CONVERSATION_STYLE].some(style => updated.includes(style))
    ? updated
    : updated ? `${updated}\n\n${CONVERSATION_STYLE}` : CONVERSATION_STYLE;
}

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
const PREVIOUS_CONVERSATION_STYLE = [
  "Mycellios conversation style:",
  "User/Mico language, length and format take priority, including requests for detail, tutorials, code or complete reports.",
  "Otherwise, answer in 1-3 short sentences or at most 3 short bullets. Lead with the result or the next action the user needs, then stop. Use more only when necessary to answer completely and accurately.",
  "For ordinary replies, use plain paragraphs without headings, bold section labels, filler or unrequested emoji. Do not add a summary that repeats the answer you just gave.",
  "Keep commands, paths, checksums, logs, signatures and troubleshooting history out of the reply unless requested or needed for the user's decision. Mention only limitations that affect this request.",
  "Before tools, give one short line unless silence is required. Update only for a material finding, change or blocker; never narrate each tool call or repeat progress in the final answer.",
  "Use ask_user forms for missing decisions; group up to three questions. Do not re-ask known facts. Skip is no consent.",
  "Keep important failures, required approvals, costs and unfinished work clear. Never claim an unverified result. Keep reasoning private and respect approvals.",
].join("\n");

const NATURAL_NARRATION = "Before tools, give one short line unless silence is required. Update only for a material finding, change or blocker; never narrate each tool call or repeat progress in the final answer.";
const CLASSIC_NARRATION = "Answer directly without announcing setup or routine tool use. During work, update only for a material finding, changed plan, failure or required user input. End with the result and necessary limits; do not stop merely to report progress.";
export const CONVERSATION_STYLE = PREVIOUS_CONVERSATION_STYLE.replace(
  "Otherwise, answer in 1-3 short sentences or at most 3 short bullets. Lead with the result or the next action the user needs, then stop. Use more only when necessary to answer completely and accurately.",
  "Otherwise, give the shortest complete answer first, usually 1-3 short sentences or up to 3 short bullets. For a status question, state the current result, the blocker if any, and the next necessary action; then stop. Expand only for requested detail or essential accuracy.",
).replace(
  "Keep commands, paths, checksums, logs, signatures and troubleshooting history out of the reply unless requested or needed for the user's decision. Mention only limitations that affect this request.",
  "Keep technical diagnostics and investigation history out unless requested or needed for a decision. Summarize teammate replies instead of forwarding their reports; keep routine coordination internal. Report a correction once with the corrected fact, without retelling the whole investigation. Do not add unsolicited critique, alternatives or follow-up questions. Preserve requested deliverables verbatim and important approvals, costs and failures.",
);
const PREVIOUS_CLASSIC_STYLE = PREVIOUS_CONVERSATION_STYLE.replace(NATURAL_NARRATION, CLASSIC_NARRATION);
export const CLASSIC_CONVERSATION_STYLE = CONVERSATION_STYLE.replace(
  "Before tools, give one short line unless silence is required. Update only for a material finding, change or blocker; never narrate each tool call or repeat progress in the final answer.",
  "Answer directly without announcing setup or routine tool use. During work, update only for a material finding, changed plan, failure or required user input. End with the result and necessary limits; do not stop merely to report progress.",
);

export function conversationStyle(style: "natural" | "classic" = "natural"): string {
  return style === "classic" ? CLASSIC_CONVERSATION_STYLE : CONVERSATION_STYLE;
}

/** Refresh only exact known host blocks; keep owner instructions and all history intact.
 * Put the selected policy last so long task/tool instructions cannot bury it. */
export function withConversationStyle(instructions: string): string {
  const known = [LEGACY_CONVERSATION_STYLE, PREVIOUS_CONVERSATION_STYLE,
    PREVIOUS_CLASSIC_STYLE, CONVERSATION_STYLE, CLASSIC_CONVERSATION_STYLE];
  let selected: "natural" | "classic" = "natural", last = -1;
  let updated = instructions;
  for (const block of known) {
    const position = instructions.lastIndexOf(block);
    if (position > last) {
      last = position;
      selected = block === PREVIOUS_CLASSIC_STYLE || block === CLASSIC_CONVERSATION_STYLE ? "classic" : "natural";
    }
    updated = updated.split(`${block}\n\n`).join("")
      .split(`\n\n${block}`).join("")
      .split(`\n${block}\n`).join("\n")
      .split(block).join("");
  }
  const style = conversationStyle(selected);
  return updated ? `${updated}\n\n${style}` : style;
}

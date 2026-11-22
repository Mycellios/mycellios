export type GroupMemberRef = {
  id: string;
  name: string;
};

const MENTION_PATTERN = /@([A-Za-z0-9][A-Za-z0-9_-]{0,39})/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasMentionToken(text: string, name: string): boolean {
  const normalized = name.trim();
  if (!normalized) return false;
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}_-])@${escapeRegExp(normalized)}(?![\\p{L}\\p{N}_-])`,
    "iu",
  ).test(text);
}

export function parseMentionNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const name = match[1];
    if (name) names.add(name.toLowerCase());
  }
  return [...names];
}

/**
 * Who a group message wakes: typed mention chips, @everyone, then @Name tokens. A message that
 * names nobody goes to the group's lead (the person's choice), else to its first member. No
 * model is asked to route, so every message costs at most the turns of the members it wakes.
 */
export function resolveGroupTargetBotIds(input: {
  text: string;
  members: GroupMemberRef[];
  /** Bot ids from typed mention chips (non-members are ignored for wake). */
  explicitMentions?: string[];
  /** The lead the person chose; ignored when it is no longer a member. */
  leadBotId?: string | null;
}): string[] {
  const addressed = addressedGroupBotIds(input);
  if (addressed.length) return addressed;
  const lead = groupLeadBotId(input.members, input.leadBotId);
  return lead ? [lead] : [];
}

/** The member that takes messages addressed to nobody: the chosen lead, else the first member. */
export function groupLeadBotId(
  members: readonly GroupMemberRef[],
  leadBotId?: string | null,
): string | undefined {
  return (leadBotId && members.some((member) => member.id === leadBotId) ? leadBotId : undefined) ?? members[0]?.id;
}

/** The members a group message names itself, without the lead fallback. */
export function addressedGroupBotIds(input: {
  text: string;
  members: GroupMemberRef[];
  explicitMentions?: string[];
}): string[] {
  const membersById = new Map(input.members.map((member) => [member.id, member]));
  const targetIds = new Set<string>();

  for (const mentionId of input.explicitMentions ?? []) {
    // Out-of-chat bots stay as @Name in the prompt; only members are woken here.
    if (membersById.has(mentionId)) targetIds.add(mentionId);
  }

  if (hasMentionToken(input.text, "everyone")) {
    for (const member of input.members) targetIds.add(member.id);
  } else {
    for (const member of input.members) {
      if (hasMentionToken(input.text, member.name) || addressesByName(input.text, member.name))
        targetIds.add(member.id);
    }
  }

  return [...targetIds];
}

/** A message that opens by calling a member by name: "Ana, …" or "Ana: …". */
function addressesByName(text: string, name: string): boolean {
  const normalized = name.trim();
  if (!normalized) return false;
  return new RegExp(`^\\s*${escapeRegExp(normalized)}\\s*[,:]`, "iu").test(text);
}

const CONTINUE_PHRASES = new Set([
  "continue", "continue please", "please continue", "keep going", "go on", "carry on", "resume",
  "go ahead and continue", "pick it up again", "proceed",
  "continua", "continúa", "continuad", "continuar", "sigue", "seguid", "sigue adelante", "sigue por favor",
  "continua por favor", "continúa por favor", "por favor continua", "por favor continúa", "reanuda", "retoma",
  "weiter", "mach weiter", "weitermachen", "fortfahren", "continuez", "reprends", "doorgaan", "ga door",
  "continuar por favor", "prossiga", "продолжай", "продолжить", "続けて", "继续", "계속",
]);

/**
 * A short message that only asks the group to go on with work that stopped ("continue",
 * "keep going", "sigue"...). Anything longer is a new request, even when it starts that way.
 */
export function isContinueRequest(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!?¡¿…,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 && normalized.length <= 40 && CONTINUE_PHRASES.has(normalized);
}

/** The longest part of the earlier request a continue turn repeats. */
const CONTINUE_REQUEST_MAX_LENGTH = 4_000;

/** The turn a member gets when the person asks the group to continue work that stopped. */
export function groupContinuePrompt(requestText: string): string {
  const request = requestText.trim().slice(0, CONTINUE_REQUEST_MAX_LENGTH);
  return [
    "The person asks you to continue the work on their earlier request in this group; your part stopped before it was done.",
    ...(request ? ["Their earlier request:", "<earlier_request>", request, "</earlier_request>"] : []),
    "Pick up from where you stopped: check what this conversation and your workspace already show as done, keep it, do not start over, and finish the rest.",
  ].join("\n");
}

export function inferHandoffTargetName(prompt: string): string | undefined {
  const handoffMatch =
    /hand(?:\s+this|\s+off|\s+it)?\s+to\s+@?([A-Za-z0-9][A-Za-z0-9_-]{0,39})/i.exec(prompt) ??
    /@([A-Za-z0-9][A-Za-z0-9_-]{0,39})\s+take/i.exec(prompt);
  return handoffMatch?.[1];
}

export function inferHandoffTargetBotId(
  prompt: string,
  members: GroupMemberRef[],
): string | undefined {
  const handedTo = members.find((member) => {
    const escaped = escapeRegExp(member.name.trim());
    return escaped
      ? new RegExp(`\\bto\\s+@?${escaped}(?![\\p{L}\\p{N}_-])`, "iu").test(prompt)
      : false;
  });
  if (handedTo) return handedTo.id;
  const mentioned = members.find((member) => hasMentionToken(prompt, member.name));
  if (mentioned) return mentioned.id;
  const name = inferHandoffTargetName(prompt)?.toLowerCase();
  return name ? members.find((member) => member.name.toLowerCase() === name)?.id : undefined;
}

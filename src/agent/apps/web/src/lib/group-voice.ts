import type { GroupMember, Run, ThreadMessage } from "@mycellios/contracts";
import {
  addressedGroupBotIds,
  groupLeadBotId,
  isRunWorking,
  speechFromBlocks,
} from "@mycellios/core";

type ReplyMessage = Pick<ThreadMessage, "id" | "role" | "blocks" | "botId" | "runId" | "progress">;
type RunRef = Pick<Run, "id" | "botId" | "status">;

/** A durable Mico reply; live step notes and subagent rows are not answers. */
function isReply(message: ReplyMessage): message is ReplyMessage & { botId: string } {
  return (
    message.role === "bot" &&
    Boolean(message.botId) &&
    !message.progress &&
    !message.id.startsWith("progress:") &&
    !message.id.startsWith("subagent:")
  );
}

/** Ids of the runs that are still producing their reply. */
export function workingRunIds(runs: readonly (RunRef | null | undefined)[]): Set<string> {
  return new Set(
    runs
      .filter((run): run is RunRef => Boolean(run && isRunWorking(run.status)))
      .map((run) => run.id),
  );
}

/**
 * Replies of the voice turn whose own Mico has finished, oldest first. Each member's answer
 * can be read while the others still work.
 */
export function finishedGroupReplies<M extends ReplyMessage>(
  messages: readonly M[],
  runIds: ReadonlySet<string>,
  seen: ReadonlySet<string>,
  working: ReadonlySet<string>,
): Array<M & { botId: string }> {
  return messages.filter(
    (message): message is M & { botId: string } =>
      isReply(message) &&
      Boolean(message.runId) &&
      runIds.has(message.runId!) &&
      !seen.has(message.id) &&
      !working.has(message.runId!),
  );
}

/** Consecutive replies of one Mico become one utterance in that Mico's voice. */
export function groupRepliesBySpeaker(
  messages: readonly (ReplyMessage & { botId: string })[],
): Array<{ botId: string; text: string }> {
  const parts: Array<{ botId: string; text: string }> = [];
  for (const message of messages) {
    const text = speechFromBlocks(message.blocks);
    if (!text) continue;
    const last = parts.at(-1);
    if (last?.botId === message.botId) last.text += `\n\n${text}`;
    else parts.push({ botId: message.botId, text });
  }
  return parts;
}

/** The member the voice panel shows: the one still working on the turn, else the lead. */
export function groupVoiceMember(
  members: readonly GroupMember[],
  leadBotId: string | null | undefined,
  working: readonly RunRef[] = [],
): GroupMember | undefined {
  const busy = working.find(
    (run) => isRunWorking(run.status) && members.some((member) => member.botId === run.botId),
  );
  const id =
    busy?.botId ??
    groupLeadBotId(
      members.map((member) => ({ id: member.botId, name: member.name })),
      leadBotId,
    );
  return members.find((member) => member.botId === id);
}

/**
 * The reply to read aloud after the person's newest message in a group: the first answer, or
 * the first from a member the message named. Undefined until that answer's turn has finished.
 */
export function groupReplyToRead<M extends ReplyMessage>(
  messages: readonly M[],
  members: readonly GroupMember[],
  activeRuns: readonly RunRef[] = [],
): (M & { botId: string }) | undefined {
  let start = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]!.role === "user") {
      start = index;
      break;
    }
  }
  if (start < 0) return undefined;
  const working = workingRunIds(activeRuns);
  const replies = messages
    .slice(start + 1)
    .filter(
      (message): message is M & { botId: string } =>
        isReply(message) && Boolean(speechFromBlocks(message.blocks)),
    );
  const request = speechFromBlocks(messages[start]!.blocks);
  const named = new Set(
    addressedGroupBotIds({
      text: request,
      members: members.map((member) => ({ id: member.botId, name: member.name })),
    }),
  );
  const reply = named.size ? replies.find((message) => named.has(message.botId)) : replies[0];
  return reply && !(reply.runId && working.has(reply.runId)) ? reply : undefined;
}

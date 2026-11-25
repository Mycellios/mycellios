import type { MessageBlock } from "@mycellios/contracts";

/** Instruction-stack note for bots whose owner has a messaging identity. */
export function messagingDmSurfaceNote(): string {
  return [
    "Chat surface: the owner also reaches you over a messaging app (iMessage/SMS, Slack, WhatsApp, or similar).",
    "That conversation and this one are the same thread; anything you reply here is mirrored to their chat.",
    "Keep replies concise. They arrive as chat messages.",
  ].join(" ");
}

/**
 * Hard privacy rules for a Space member's own conversation with a shared Mico
 * (specs/space-members): the person is not the Mico's owner.
 */
export function spaceMemberPrivacyBlock(memberName: string): string {
  const name = sanitizeMessagingLabel(memberName) || "A member of this Space";
  return [
    `You are talking with ${name}, a person your owner shared you with in this Space. They are not your owner.`,
    "Never reveal or share your owner's personal information, memories, other conversations, connected accounts, secrets or files.",
    "You have no computer, memory or connected apps in this conversation; answer from the conversation and the web.",
  ].join("\n");
}

/** Hard privacy rules for bots posting into shared group channels. */
export function messagingChannelPrivacyBlock(): string {
  return [
    "You are posting to a group chat with multiple people through the deployment's shared messaging line.",
    "Never reveal or share the owner's personal information, memory contents, scratchpad, or 1:1 conversation contents in the group.",
    'Your posts are publicly attributed to the owner ("<name>\'s agent: …").',
    "Reply only when you add value to the group; otherwise finish silently without posting.",
  ].join("\n");
}

export function messagingChannelId(sourceBlocks: MessageBlock[] | undefined): string | undefined {
  return sourceBlocks?.find((block) => block.kind === "channel_message")?.channelId;
}

/** Channel runs are messaging runs whose waking message came from a channel. */
export function isMessagingChannelRun(
  trigger: string,
  sourceBlocks: MessageBlock[] | undefined,
): boolean {
  return trigger === "messaging" && Boolean(messagingChannelId(sourceBlocks));
}

/**
 * Group names and owner names are attacker-controlled text interpolated
 * into prompts and DMs; strip framing characters before they get near one.
 */
export function sanitizeMessagingLabel(value: string): string {
  return value
    .replace(/[\r\n"[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

import type { MessageBlock } from "@mycellios/contracts";
import { automaticThreadTitle, THREAD_TITLE_MAX_CHARACTERS } from "./thread-lifecycle.js";

/**
 * Branching copies a finished turn of a Mico's main chat or side conversation into a new
 * conversation of the same Mico. Everything here is written for this product.
 */

/** The newest messages a branch copies at most; older ones stay in the source. */
export const BRANCH_MESSAGE_LIMIT = 1_000;
/** Messages read from the source before the transcript filter keeps the visible ones. */
export const BRANCH_MESSAGE_SCAN_LIMIT = 2_000;
/** Files a branch copies at most, and their combined size. */
export const BRANCH_FILE_LIMIT = 200;
export const BRANCH_FILE_BYTES_LIMIT = 1024 * 1024 * 1024;
/** The title of a branch whose source gives nothing to name it after. */
export const BRANCH_TITLE_FALLBACK = "Branched conversation";

export const BRANCH_WHILE_WORKING_ERROR =
  "This conversation is still working on a turn. Stop it or wait until the turn ends, then branch it.";
export const BRANCH_MESSAGE_ERROR = "Branch from a Mico reply of a finished turn.";
export const BRANCH_SOURCE_ERROR = "This conversation cannot be branched.";
export const BRANCH_TOO_LARGE_ERROR = `This conversation has more than ${BRANCH_FILE_LIMIT} files, or more than 1 GB of files, to copy. Start a new conversation instead.`;
export const BRANCH_CHANGED_ERROR =
  "The conversation changed while it was being copied. Try again.";

/**
 * What the first turn of a branch is told. The copied messages arrive as its history; this
 * says where they came from and that the computer kept its current files.
 */
export const BRANCH_HANDOFF_NOTE =
  "This conversation is a branch: the messages before this turn were copied from another conversation of yours, up to the turn it was branched from, and from here on the two continue separately. Files in your workspace were not rolled back to that point. They may have changed since then, also through the other conversation, so read a file again before you rely on it or change it.";

/** What the divider at the end of the copied history means, when a model reads it as history. */
export const BRANCH_ORIGIN_HISTORY_TEXT =
  "[The messages above were copied from another conversation when this branch was made. Workspace files were not rolled back.]";

/** The thread key of a branch, unique per owner and Space, so a retried request finds it. */
export function branchThreadKey(botId: string, requestId: string): string {
  return `mico-task:${botId}:branch:${requestId}`;
}

/** Prefix of the client nonce of every file copied into one branch. */
export function branchFileNoncePrefix(threadId: string): string {
  return `branch-copy:${threadId}:`;
}

export function isBranchFileNonce(nonce: string | null | undefined): boolean {
  return Boolean(nonce?.startsWith("branch-copy:"));
}

const NUMBERED = /^(.*\S) #(\d{1,6})$/u;

/** A source title without the " #N" a branch added to it, so branches of branches count on. */
export function branchTitleBase(title: string, sourceIsBranch: boolean): string {
  const match = sourceIsBranch ? NUMBERED.exec(title) : null;
  return match?.[1] ?? title;
}

/** The number N in "{base} #N" when a title has that form. */
export function branchTitleNumber(title: string, base: string): number | null {
  const match = NUMBERED.exec(title);
  if (!match || match[1] !== base) return null;
  const value = Number(match[2]);
  return Number.isSafeInteger(value) ? value : null;
}

/** "{base} #N", cutting the base (never the number) to stay within 120 characters. */
export function numberedBranchTitle(base: string, number: number): string {
  const suffix = ` #${number}`;
  const room = THREAD_TITLE_MAX_CHARACTERS - suffix.length;
  const characters = Array.from(base.trim());
  const fitted =
    characters.length <= room
      ? characters.join("")
      : `${characters
          .slice(0, room - 1)
          .join("")
          .trimEnd()}…`;
  return `${fitted}${suffix}`;
}

/**
 * The title of a new branch. A side conversation's branch is "{title} #N", N one more than
 * the highest number its family already uses (the source counts as #1, so the first is #2).
 * A branch of the main chat, or of a conversation without a title, is named after the last
 * message the person wrote in the copy.
 */
export function branchConversationTitle(input: {
  sourceTitle: string | null;
  sourceIsMainChat: boolean;
  sourceIsBranch: boolean;
  existingTitles: readonly string[];
  lastUserBlocks: readonly MessageBlock[] | null;
}): string {
  const title = input.sourceIsMainChat ? "" : (input.sourceTitle ?? "").trim();
  if (title) {
    const base = branchTitleBase(title, input.sourceIsBranch);
    let highest = 1;
    for (const existing of [title, ...input.existingTitles]) {
      const number = branchTitleNumber(existing, base);
      if (number !== null && number > highest) highest = number;
    }
    return numberedBranchTitle(base, highest + 1);
  }
  return (
    (input.lastUserBlocks && automaticThreadTitle(input.lastUserBlocks)) || BRANCH_TITLE_FALLBACK
  );
}

/** The artifacts a message's blocks show: images, files and finished generated images. */
export function blockArtifactIds(blocks: readonly MessageBlock[]): string[] {
  const ids: string[] = [];
  for (const block of blocks) {
    if (
      (block.kind === "image" || block.kind === "file" || block.kind === "image_generation") &&
      block.artifactId
    )
      ids.push(block.artifactId);
  }
  return ids;
}

/** The same blocks, pointing at the copies of their artifacts. Unknown ids are left as they are. */
export function withCopiedArtifacts(
  blocks: readonly MessageBlock[],
  copies: ReadonlyMap<string, string>,
): MessageBlock[] {
  return blocks.map((block) => {
    if (
      (block.kind === "image" || block.kind === "file" || block.kind === "image_generation") &&
      block.artifactId
    ) {
      const copy = copies.get(block.artifactId);
      return copy ? { ...block, artifactId: copy } : block;
    }
    return block;
  });
}

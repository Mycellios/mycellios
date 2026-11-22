import type { MessageBlock } from "@mycellios/contracts";
import { ACTIVE_RUN_STATUSES, BACKGROUND_RUN_TRIGGERS } from "./run-state.js";
import type { TaskThreadKind } from "./work-resources.js";

/** Who gave a side thread its current title. A user title is never replaced automatically. */
export const THREAD_TITLE_SOURCES = ["auto", "agent", "user"] as const;
export type ThreadTitleSource = (typeof THREAD_TITLE_SOURCES)[number];

/** What opened a side thread. Labels and limits only; it never grants access. */
export const THREAD_STARTED_BY = ["user", "agent", "routine", "branch", "delegation"] as const;
export type ThreadStartedBy = (typeof THREAD_STARTED_BY)[number];

/** How the last finished turn of a side thread ended. */
export const THREAD_OUTCOMES = ["completed", "failed", "interrupted"] as const;
export type ThreadOutcome = (typeof THREAD_OUTCOMES)[number];

/** What a side thread is doing now, derived from its runs and archive state, never stored. */
export const THREAD_STATES = ["running", "queued", "waiting", "idle", "closed"] as const;
export type ThreadState = (typeof THREAD_STATES)[number];

export const THREAD_TITLE_MAX_CHARACTERS = 120;
export const THREAD_LAST_ERROR_MAX_CHARACTERS = 2000;
/** A deleted conversation stays recoverable for this long before the server removes it. */
export const THREAD_DELETE_UNDO_MS = 6_000;
/** The worker finishes a delete this long after its undo window, so a late Undo never races it. */
export const THREAD_DELETE_GRACE_MS = 5_000;
/** Archive stops the conversation first and waits at most this long for it to settle. */
export const THREAD_ARCHIVE_SETTLE_MS = 15_000;

export const THREAD_TITLE_INVALID_ERROR =
  "Use a title of 1 to 120 characters, on one line and without control characters.";
export const THREAD_STILL_WORKING_ERROR =
  "This conversation is still working. Stop it, then try again.";
export const THREAD_DELETE_WHILE_WORKING_ERROR =
  "This conversation is still working. Stop it before you delete it.";
export const THREAD_BEING_DELETED_ERROR =
  "This conversation is being deleted. Undo the deletion to write in it again.";
export const THREAD_ALREADY_DELETED_ERROR = "This conversation has already been deleted.";
export const THREAD_MAIN_CHAT_LIFECYCLE_ERROR =
  "The main chat stays open: it cannot be archived or deleted.";

// Line breaks are handled separately; everything else in C0, DEL and C1 is refused in a title.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are the point.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are the point.
const CONTROL_RUNS = /[\s\u0000-\u001f\u007f-\u009f]+/gu;
const LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/u;

function fitTitle(text: string): string {
  const characters = Array.from(text.replace(CONTROL_RUNS, " ").trim());
  if (characters.length <= THREAD_TITLE_MAX_CHARACTERS) return characters.join("");
  return `${characters.slice(0, THREAD_TITLE_MAX_CHARACTERS - 1).join("").trimEnd()}…`;
}

/**
 * The title a conversation takes from its first user message, without a model: the first
 * line that has text, cut to 120 characters with a closing "…". A message with only files
 * is named after its first file. Returns null when there is nothing to name it after.
 */
export function automaticThreadTitle(blocks: readonly MessageBlock[]): string | null {
  for (const block of blocks) {
    if (block.kind !== "text") continue;
    for (const line of block.text.split(LINE_BREAK)) {
      const title = fitTitle(line);
      if (title) return title;
    }
  }
  for (const block of blocks) {
    if (block.kind !== "file" && block.kind !== "image") continue;
    const title = block.name ? fitTitle(block.name) : "";
    if (title) return title;
  }
  return null;
}

/** A title someone typed: trimmed, 1-120 characters, one line, no control characters. */
export function parseThreadTitle(
  input: string,
): { ok: true; title: string } | { ok: false; error: string } {
  const title = input.trim();
  const length = Array.from(title).length;
  if (!length || length > THREAD_TITLE_MAX_CHARACTERS || CONTROL_CHARACTERS.test(title))
    return { ok: false, error: THREAD_TITLE_INVALID_ERROR };
  return { ok: true, title };
}

/** The opener recorded for a thread that predates the column, from its server-made identity. */
export function threadStartedByForKind(kind: TaskThreadKind): ThreadStartedBy {
  if (kind === "delegation") return "delegation";
  if (kind === "routine" || kind === "workflow") return "routine";
  return "user";
}

/** The turn outcome a finished run leaves on its thread. */
export function threadOutcomeForRun(status: string): ThreadOutcome | null {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "interrupted";
  return null;
}

/** Keeps a run error within what a thread stores; an empty error stores nothing. */
export function boundThreadError(error: string | null | undefined): string | null {
  if (!error?.trim()) return null;
  const characters = Array.from(error);
  return characters.length > THREAD_LAST_ERROR_MAX_CHARACTERS
    ? characters.slice(0, THREAD_LAST_ERROR_MAX_CHARACTERS).join("")
    : error;
}

/** Background work stays out of a conversation's state and outcome. */
export function countsForThreadLifecycle(trigger: string | null | undefined): boolean {
  return !(BACKGROUND_RUN_TRIGGERS as readonly string[]).includes(trigger ?? "");
}

const ACTIVE = new Set<string>(ACTIVE_RUN_STATUSES);

/**
 * Archived or deleting conversations are closed. Otherwise a run that waits on the person
 * wins over work in progress, which wins over queued work.
 */
export function deriveThreadState(input: {
  archivedAt?: Date | string | null;
  deleteAfter?: Date | string | null;
  activeRunStatuses: readonly string[];
}): ThreadState {
  if (input.archivedAt || input.deleteAfter) return "closed";
  const active = input.activeRunStatuses.filter((status) => ACTIVE.has(status));
  if (active.some((status) => status === "waiting_input" || status === "waiting_takeover"))
    return "waiting";
  if (active.some((status) => status === "leased" || status === "running")) return "running";
  if (active.includes("queued")) return "queued";
  return "idle";
}

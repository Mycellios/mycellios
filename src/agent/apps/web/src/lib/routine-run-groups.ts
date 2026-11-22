import type { MessageBlock, ThreadMessage } from "@mycellios/contracts";
import type { ThreadItem } from "@mycellios/core";

export type RoutineRunBlock = Extract<MessageBlock, { kind: "routine_run" }>;

/** Consecutive markers of one routine's runs, shown in the main chat as one line. */
export interface RoutineRunGroup {
  /** The first member's id: the line is drawn there and keeps its place as runs are added. */
  key: string;
  memberIds: string[];
  runs: Array<{ id: string; createdAt: string; block: RoutineRunBlock }>;
}

export function routineRunBlock(message: Pick<ThreadMessage, "blocks">): RoutineRunBlock | null {
  for (const block of message.blocks) if (block.kind === "routine_run") return block;
  return null;
}

/**
 * Groups each run of consecutive routine run markers of the same routine, a single marker
 * included, so the main chat shows one line per stretch instead of one per run. Any other row
 * between two markers starts a new group. The result maps every member id to its group.
 */
export function routineRunGroups(
  items: readonly ThreadItem<ThreadMessage>[],
): Map<string, RoutineRunGroup> {
  const byMember = new Map<string, RoutineRunGroup>();
  let current: RoutineRunGroup | null = null;
  const close = () => {
    if (current) for (const id of current.memberIds) byMember.set(id, current);
    current = null;
  };
  for (const item of items) {
    const block = item.kind === "message" ? routineRunBlock(item.message) : null;
    if (!block || item.kind !== "message") {
      close();
      continue;
    }
    const run = { id: item.message.id, createdAt: item.message.createdAt, block };
    if (current && current.runs[0]?.block.routineId === block.routineId) {
      current.memberIds.push(run.id);
      current.runs.push(run);
      continue;
    }
    close();
    current = { key: run.id, memberIds: [run.id], runs: [run] };
  }
  close();
  return byMember;
}

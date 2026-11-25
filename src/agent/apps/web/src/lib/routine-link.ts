import type { Routine } from "@mycellios/contracts";

/** `?routine=` value that asks for a new draft, as the Schedule's Create Routine sends it. */
export const NEW_ROUTINE_LINK = "new";

/**
 * What a `?routine=` link opens in the routine editor. A new draft needs no saved list; a saved
 * routine waits for this Mico's list (`null`) and is "missing" once that list no longer has it.
 */
export function routineLinkTarget(
  routineId: string,
  routines: readonly Routine[] | null,
): { routine: Routine | undefined } | "missing" | null {
  if (routineId === NEW_ROUTINE_LINK) return { routine: undefined };
  if (!routines) return null;
  const routine = routines.find((item) => item.id === routineId);
  return routine ? { routine } : "missing";
}

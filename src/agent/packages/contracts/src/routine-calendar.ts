import * as z from "zod";
import { RoutineSchema } from "./domain.js";
import { Id, IsoDate, RunStatus } from "./ids.js";

export const RoutineCalendarInputSchema = z
  .object({ from: IsoDate, to: IsoDate })
  .refine(
    ({ from, to }) =>
      Date.parse(to) > Date.parse(from) && Date.parse(to) - Date.parse(from) <= 64 * 86_400_000,
    "Choose a calendar range of at most 64 days.",
  );
export const RoutineCalendarEntrySchema = z.object({
  id: Id,
  routineId: Id,
  at: IsoDate,
  status: z.union([RunStatus, z.enum(["scheduled", "paused"])]),
  projected: z.boolean(),
  error: z.string().nullable(),
});
export const RoutineCalendarSchema = z.object({
  now: IsoDate,
  routines: z.array(RoutineSchema),
  entries: z.array(RoutineCalendarEntrySchema),
  truncated: z.boolean(),
  invalidRoutineIds: z.array(Id),
});
export type RoutineCalendarEntry = z.infer<typeof RoutineCalendarEntrySchema>;
export type RoutineCalendar = z.infer<typeof RoutineCalendarSchema>;

import { t } from "@lingui/core/macro";
import type {
  RoutineEventFilter,
  RoutineEventFilterValue,
  RoutineWebhookState,
} from "@mycellios/contracts";
import {
  ROUTINE_EVENT_FILTER_MAX,
  RoutineEventPointerSchema,
  RoutineEventTypeSchema,
} from "@mycellios/contracts";

/** A filter as the editor holds it: the value is typed as text until saved. */
export type RoutineEventFilterDraft = { pointer: string; value: string };

/**
 * The value a filter text means: JSON (42, true, null, "42") when it reads as a single JSON
 * value, otherwise the text itself.
 */
export function parseFilterValue(text: string): RoutineEventFilterValue {
  const trimmed = text.trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      parsed === null ||
      typeof parsed === "string" ||
      typeof parsed === "boolean" ||
      (typeof parsed === "number" && Number.isFinite(parsed))
    )
      return parsed as RoutineEventFilterValue;
  } catch {
    // Plain text.
  }
  return trimmed;
}

/** The text that reads back as the same value: a string that looks like JSON keeps its quotes. */
export function filterValueText(value: RoutineEventFilterValue): string {
  if (typeof value === "string") return parseFilterValue(value) === value ? value : JSON.stringify(value);
  return JSON.stringify(value);
}

export function filterDraftsFromWebhook(
  webhook: Pick<RoutineWebhookState, "filters"> | undefined,
): RoutineEventFilterDraft[] {
  return (webhook?.filters ?? []).map((filter) => ({
    pointer: filter.pointer,
    value: filterValueText(filter.value),
  }));
}

/** The event type and filters as the api takes them, or the reason they cannot be saved. */
export function webhookSettingsFromDraft(draft: {
  webhookEventType?: string;
  webhookFilters?: RoutineEventFilterDraft[];
}):
  | { webhookEventType: string | null; webhookFilters: RoutineEventFilter[] }
  | { error: string } {
  const type = (draft.webhookEventType ?? "").trim();
  if (type && !RoutineEventTypeSchema.safeParse(type).success) {
    return { error: t`Enter the event type as the sender writes it, without spaces.` };
  }
  const filters: RoutineEventFilter[] = [];
  for (const row of draft.webhookFilters ?? []) {
    const field = row.pointer.trim();
    if (!field && !row.value.trim()) continue;
    const pointer = field.startsWith("/") ? field : `/${field}`;
    if (!RoutineEventPointerSchema.safeParse(pointer).success) {
      return { error: t`Enter a data field such as /status.` };
    }
    filters.push({ pointer, value: parseFilterValue(row.value) });
  }
  if (filters.length > ROUTINE_EVENT_FILTER_MAX) {
    return { error: t`A routine can check up to ${ROUTINE_EVENT_FILTER_MAX} filters.` };
  }
  return { webhookEventType: type || null, webhookFilters: filters };
}

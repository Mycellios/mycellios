import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import type { Routine } from "@mycellios/contracts";

/** "Paused", or which of its own runs paused the routine, so that pause is never silent. */
export function routinePausedLabel(
  routine: Pick<Routine, "pausedByRunAt">,
  locale = i18n.locale,
): string {
  if (!routine.pausedByRunAt) return t`Paused`;
  const time = new Date(routine.pausedByRunAt).toLocaleString(locale || "en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return t`Paused by its ${time} run`;
}

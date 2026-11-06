import { t } from "@lingui/core/macro";
import type { Routine } from "@rakazo/contracts";
import { formatCron, isOneShotRoutineCron, presetFromCron } from "@rakazo/core";
import { describeCronPresetLocalized } from "../RoutineSchedule";

/** Read the saved trigger, including a one-shot's real date in its own time zone. */
export function routineDiagramSummary(routine: Routine, locale: string) {
  const parts: string[] = [];
  if (routine.webhookEnabled) parts.push(t`When a webhook fires`);
  if (routine.githubEnabled) parts.push(t`Git event`);
  if (routine.messageProvider) parts.push(`${routine.messageProvider} · ${t`Message event`}`);
  if (routine.watch) parts.push(t`When something changes`);
  for (const cron of routine.crons) {
    if (isOneShotRoutineCron(cron)) {
      const at = routine.nextRunAt ?? routine.lastRunAt;
      parts.push(at ? `${t`One-time schedule`} · ${new Date(at).toLocaleString(locale || "en", { timeZone: routine.timezone, dateStyle: "medium", timeStyle: "short" })}` : t`One-time schedule`);
    } else {
      const preset = presetFromCron(cron);
      if (preset.freq === "Advanced") parts.push(formatCron(cron));
      else { const summary = describeCronPresetLocalized(preset, locale); parts.push([summary.lead, summary.detail].filter(Boolean).join(" ")); }
    }
  }
  return parts.join(", ") || t`No trigger`;
}

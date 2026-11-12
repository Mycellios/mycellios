import { useLingui } from "@lingui/react/macro";
import { MessageCircleQuestion } from "lucide-react";

/** Shares the row's navigation; never nests another button inside the roster button. */
export function RosterReplyIndicator({ status, avatar = false }: { status: string; avatar?: boolean }) {
  const { t } = useLingui();
  if (status !== "waiting_input") return null;
  return avatar ? <span data-roster-question aria-label={t`Needs an answer`}
    className="absolute -end-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full bg-warning/15 text-warning ring-2 ring-sidebar">
    <MessageCircleQuestion size={11} strokeWidth={1.8} aria-hidden />
  </span> : <span data-roster-answer
    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium leading-none text-warning">
    <MessageCircleQuestion size={11} strokeWidth={1.8} aria-hidden />{t`Answer`}
  </span>;
}

import { useLingui } from "@lingui/react/macro";
import { TriangleAlert } from "lucide-react";

/**
 * Quiet warning for a model whose context window is too small for a Mico. Screen readers get the
 * explanation through `aria-describedby` on the row, pointing at `SmallContextHint`.
 */
export function SmallContextMark() {
  const { t } = useLingui();
  return (
    <span
      className="flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-1.5 text-[11px] text-warning"
      title={t`Micos need about 32k tokens of context, so this model may not work well.`}
      aria-hidden="true"
      data-small-context
    >
      <TriangleAlert size={11} strokeWidth={2} />
      {t`Small context`}
    </span>
  );
}

/** The words behind the mark, hidden from sight and read out for the row or trigger. */
export function SmallContextHint({ id }: { id: string }) {
  const { t } = useLingui();
  return (
    <span id={id} hidden>
      {t`Small context: Micos need about 32k tokens of context, so this model may not work well.`}
    </span>
  );
}

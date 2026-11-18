import type { ReactNode } from "react";
import { memo } from "react";

/**
 * Keeps the last rendered children while a full-viewport overlay covers them.
 * Shell re-renders (settings writes, query refreshes) then skip the hidden roster
 * and transcript; the first render after uncovering catches up with current props.
 * State and effects inside the children keep running, so nothing is unmounted.
 */
export const FrozenWhileCovered = memo(
  function FrozenWhileCovered({ children }: { covered: boolean; children: ReactNode }) {
    return children;
  },
  (_previous, next) => next.covered,
);

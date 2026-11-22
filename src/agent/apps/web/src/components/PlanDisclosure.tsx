import { Trans } from "@lingui/react/macro";
import type { MessageBlock } from "@mycellios/contracts";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@mycellios/ui-web/components/ui/collapsible";
import { Check, ChevronRight, Circle, LoaderCircle } from "lucide-react";

type PlanBlock = Extract<MessageBlock, { kind: "plan" }>;

/** A short plan explanation names the list; a long one would crowd the row. */
const TITLE_MAX = 80;

/**
 * The turn's task list. It is open while the turn runs; a finished turn folds it into
 * "{done} of {total} tasks done", and a step still running then counts as pending.
 */
export function PlanDisclosure({ block, live }: { block: PlanBlock; live: boolean }) {
  const total = block.steps.length;
  const done = block.steps.filter((step) => step.status === "done").length;
  const title = block.explanation && block.explanation.length <= TITLE_MAX ? block.explanation : undefined;
  return (
    <Collapsible key={live ? "live" : "done"} defaultOpen={live} data-testid="plan" className="group">
      <CollapsibleTrigger className="flex min-h-6 w-fit cursor-pointer list-none items-center gap-1 rounded-md py-0.5 pe-1.5 text-[12px] font-normal text-muted-foreground outline-none hover:text-foreground/75 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
        <ChevronRight
          aria-hidden
          size={14}
          strokeWidth={1.8}
          className="transition-transform duration-150 group-data-panel-open:rotate-90 motion-reduce:transition-none"
        />
        <span dir="auto">
          {title ?? <Trans>Tasks</Trans>}
          {" · "}
          <Trans>{done} of {total} tasks done</Trans>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent hiddenUntilFound>
        <ol className="ms-[7px] mt-0.5 space-y-0.5 border-s border-border ps-3 text-xs text-muted-foreground">
          {block.steps.map((step, index) => {
            const status = !live && step.status === "running" ? "pending" : step.status;
            return (
              <li key={index} className="flex items-start gap-1.5" data-status={status} dir="auto">
                {status === "done" ? (
                  <Check aria-hidden size={12} className="mt-0.5 shrink-0" />
                ) : status === "running" ? (
                  <LoaderCircle aria-hidden size={12} className="mt-0.5 shrink-0 animate-spin motion-reduce:animate-none" />
                ) : (
                  <Circle aria-hidden size={12} className="mt-0.5 shrink-0" />
                )}
                <span className={status === "done" ? "line-through" : undefined}>{step.title}</span>
              </li>
            );
          })}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

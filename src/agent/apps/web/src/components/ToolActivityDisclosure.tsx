import { Plural, Trans } from "@lingui/react/macro";
import type { ThreadMessage } from "@rakazo/contracts";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rakazo/ui-web/components/ui/collapsible";
import { Check, ChevronRight, LoaderCircle } from "lucide-react";
import { type ReactNode, useSyncExternalStore } from "react";
import { getToolActivityExpanded, subscribeToolActivity } from "../lib/tool-activity-preference";
import { formatToolActivityDuration, toolStepCount } from "../lib/tool-activity-view";

type ToolStep = Extract<ThreadMessage["blocks"][number], { kind: "steps" }>["steps"][number];

/** While a run is live, only the most recent steps are listed so a long run does not push the chat down. */
export const LIVE_TOOL_STEP_WINDOW = 6;

export function ToolSteps({
  steps,
  currentIndex,
  limit,
}: {
  steps: readonly ToolStep[];
  currentIndex?: number;
  /** Show only the last `limit` steps, with a count of the earlier ones above them. */
  limit?: number;
}) {
  const hidden = limit !== undefined && steps.length > limit ? steps.length - limit : 0;
  const shown = hidden > 0 ? steps.slice(hidden) : steps;
  return (
    <div className="space-y-0.5" data-testid="tool-rows">
      {hidden > 0 ? (
        <div className="text-[12px] leading-5 text-muted-foreground" data-testid="tool-rows-hidden">
          <Plural value={hidden} one="+# earlier step" other="+# earlier steps" />
        </div>
      ) : null}
      {shown.map((step, offset) => {
        const index = hidden + offset;
        const isCurrent = index === currentIndex;
        return (
          <div key={index} aria-current={isCurrent ? "step" : undefined} className="flex min-w-0 items-center gap-2 leading-5">
            {isCurrent
              ? <LoaderCircle className="size-3.5 shrink-0 text-muted-foreground motion-safe:animate-spin" aria-hidden="true" />
              : <Check className="size-3.5 shrink-0 text-success" aria-hidden="true" />}
            <span
              className={`min-w-0 flex-1 truncate text-[13px] ${
                isCurrent ? "text-foreground" : "text-muted-foreground"
              }`}
              title={step.label}
            >
              {step.label}
              {step.count > 1 ? ` ×${step.count}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Tool activity stays folded until requested. Manual toggles survive new steps;
 * finishing reapplies the saved default so the reply keeps the chosen level of detail.
 */
export function ToolActivityDisclosure({
  live,
  stepCount,
  durationMs,
  children,
}: {
  live: boolean;
  stepCount: number;
  durationMs?: number;
  children: ReactNode;
}) {
  const expanded = useSyncExternalStore(subscribeToolActivity, getToolActivityExpanded, () => false);
  const duration = formatToolActivityDuration(durationMs);
  const toolCount = stepCount;
  return (
    <Collapsible
      key={`${live ? "working" : "actions"}-${expanded}`}
      defaultOpen={expanded}
      data-testid="tool-activity"
      data-live={live || undefined}
      className="group"
    >
      <CollapsibleTrigger
        className={`flex min-h-6 w-fit cursor-pointer list-none items-center gap-1 rounded-md py-0.5 pe-1.5 text-[13px] font-medium outline-none hover:text-foreground/75 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
          live ? "text-foreground/75" : "text-muted-foreground"
        }`}
      >
        <ChevronRight
          aria-hidden
          size={14}
          strokeWidth={1.8}
          className="transition-transform duration-150 group-data-panel-open:rotate-90 motion-reduce:transition-none"
        />
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span>{live ? <Trans>Activity</Trans> : <Trans>Done</Trans>}</span>
          <span className="whitespace-nowrap">
            <Plural value={toolCount} one="# tool" other="# tools" />
          </span>
          {!live && duration ? <span>{duration}</span> : null}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent hiddenUntilFound>
        <div className="ms-[7px] mt-0.5 border-s border-border ps-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A tools-only message: a plain muted line between messages, not a chat bubble.
 */
export function StandaloneToolActivity({
  live,
  steps,
  stepCount,
  durationMs,
}: {
  live: boolean;
  steps: readonly ToolStep[];
  stepCount: number;
  durationMs?: number;
}) {
  return (
    <div className="flex justify-start" dir="ltr" data-testid="tool-activity-line">
      <div className="max-w-[74%] min-w-0 ps-1">
        <ToolActivityDisclosure live={live} stepCount={stepCount} durationMs={durationMs}>
          <ToolSteps
            steps={steps}
            currentIndex={live ? steps.length - 1 : undefined}
            limit={live ? LIVE_TOOL_STEP_WINDOW : undefined}
          />
        </ToolActivityDisclosure>
      </div>
    </div>
  );
}

/** A bot message whose only visible blocks are tool cards: one slim line per card, no bubble. */
export function ToolOnlyNarration({
  blocks,
  live,
}: {
  blocks: readonly ThreadMessage["blocks"][number][];
  live: boolean;
}) {
  return (
    <>
      {blocks.map((block, i) =>
        block.kind === "steps" ? (
          <StandaloneToolActivity
            key={i}
            live={live}
            steps={block.steps}
            stepCount={toolStepCount(block.steps)}
            durationMs={block.durationMs}
          />
        ) : null,
      )}
    </>
  );
}

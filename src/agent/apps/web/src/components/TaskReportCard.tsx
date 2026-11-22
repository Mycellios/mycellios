import { Trans, useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@mycellios/chat-ui/web";
import type { MessageBlock } from "@mycellios/contracts";
import { BotAvatar } from "@mycellios/ui-web";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

type TaskReportBlock = Extract<MessageBlock, { kind: "task_report" }>;

/**
 * A finished turn of a conversation the Mico opened, folded in its main chat: the Mico's
 * next answer gives the result, so the report itself stays one click away, with a link to
 * the conversation it came from.
 */
export function TaskReportCard({ block, color }: { block: TaskReportBlock; color: string }) {
  const { t } = useLingui();
  const [expanded, setExpanded] = useState(false);
  const name = block.fromBotName;
  return (
    <div data-testid="task-report" className="flex max-w-full flex-col items-start gap-1.5 self-start">
      <button
        type="button"
        data-testid="task-report-toggle"
        aria-expanded={expanded}
        aria-label={expanded ? t`Hide the update from ${name}` : t`Show the update from ${name}`}
        onClick={() => setExpanded((value) => !value)}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground/75"
      >
        <BotAvatar color={color} identity={block.fromBotId} size={16} />
        <span dir="auto" className="truncate">
          {t`Update from ${name}`}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={1.8}
          aria-hidden="true"
          className={expanded ? "size-3.5 shrink-0 transition-transform" : "size-3.5 shrink-0 -rotate-90 transition-transform"}
        />
      </button>
      {expanded ? (
        <div
          data-testid="task-report-body"
          className="w-full max-w-xl rounded-[18px] border border-border bg-muted px-3.5 py-2.5 text-[14.5px] text-foreground"
        >
          <div dir="auto" className="mb-1 truncate text-[13px] font-medium text-muted-foreground">
            {block.title}
          </div>
          <div dir="auto" className="wrap-anywhere">
            <ChatMarkdown>{block.text}</ChatMarkdown>
          </div>
          <Link
            data-testid="task-report-open"
            to={{
              pathname: `/app/${encodeURIComponent(block.fromBotId)}`,
              search: `?task=${encodeURIComponent(block.taskId)}`,
            }}
            className="mt-1.5 inline-flex text-[13px] font-medium text-foreground underline-offset-4 hover:underline"
          >
            <Trans>Open conversation</Trans>
          </Link>
        </div>
      ) : null}
    </div>
  );
}

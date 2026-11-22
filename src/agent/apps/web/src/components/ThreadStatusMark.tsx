import { useLingui } from "@lingui/react/macro";
import { Clock, MessageCircleQuestion, X } from "lucide-react";
import type { ConversationStatus } from "../lib/thread-tabs";

/** A conversation's state at a glance, on its tab and in the picker. Its label is read aloud. */
export function ThreadStatusMark({ status, className = "" }: { status: ConversationStatus; className?: string }) {
  const { t } = useLingui();
  const label = status === "working" ? t`Working…`
    : status === "queued" ? t`Waiting in line…`
    : status === "waiting" ? t`Needs you`
    : status === "failed" ? t`Failed`
    : t`New reply`;
  const common = `inline-flex size-3.5 shrink-0 items-center justify-center ${className}`;
  if (status === "working") {
    return <span role="img" aria-label={label} title={label} data-thread-status={status} className={`${common} gap-px`}>
      {[0, 160, 320].map(delay => <span key={delay} aria-hidden="true"
        className="size-[3px] rounded-full bg-current animate-pulse motion-reduce:animate-none" style={{ animationDelay: `${delay}ms` }} />)}
    </span>;
  }
  if (status === "unread") {
    return <span role="img" aria-label={label} title={label} data-thread-status={status} className={common}>
      <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
    </span>;
  }
  const Icon = status === "queued" ? Clock : status === "waiting" ? MessageCircleQuestion : X;
  const tone = status === "failed" ? "text-destructive" : status === "waiting" ? "text-primary" : "";
  return <span role="img" aria-label={label} title={label} data-thread-status={status} className={`${common} ${tone}`}>
    <Icon size={13} aria-hidden="true" />
  </span>;
}

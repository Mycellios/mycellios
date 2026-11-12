import { useLingui } from "@lingui/react/macro";
import { Tooltip, TooltipContent, TooltipTrigger } from "@rakazo/ui-web";
import { CircleAlert, CircleCheck, Hand, LoaderCircle, MessageCircleQuestion } from "lucide-react";
import type { ReactElement } from "react";
import { rosterWorkStatusLabel } from "../lib/roster-status";

export function RosterMessagePreviewContent({ name, status, preview, hasError = false, mini = false }: {
  name: string; status: string; preview?: string | null; hasError?: boolean; mini?: boolean;
}) {
  const { t } = useLingui();
  const error = hasError || status === "failed";
  const waiting = status === "waiting_input";
  const takeover = status === "waiting_takeover";
  const working = rosterWorkStatusLabel(status);
  const label = error ? t`Error` : waiting ? t`Waiting for your response` : takeover ? t`Needs you` : working ?? t`Ready`;
  const Icon = error ? CircleAlert : waiting ? MessageCircleQuestion : takeover ? Hand : working ? LoaderCircle : CircleCheck;
  return <>
    {mini ? <p className="truncate text-xs font-medium">{name}</p> : null}
    <div className={`flex items-center gap-1.5 text-xs font-medium ${error ? "text-destructive" : waiting || takeover ? "text-warning" : working ? "text-status-working" : "text-muted-foreground"}`}>
      <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden /><span>{label}</span>
    </div>
    {preview?.trim() ? <p dir="auto" className="line-clamp-6 whitespace-pre-wrap break-words text-xs leading-relaxed font-normal text-popover-foreground">{preview.trim()}</p> : null}
    {waiting ? <p className="text-[11px] font-normal text-muted-foreground">{t`Select to reply`}</p> : takeover ? <p className="text-[11px] font-normal text-muted-foreground">{t`Select to see execution`}</p> : null}
  </>;
}

export function RosterMessagePreview({ children, disabled = false, ...message }: Parameters<typeof RosterMessagePreviewContent>[0] & {
  children: ReactElement; disabled?: boolean;
}) {
  return <Tooltip disabled={disabled}>
    <TooltipTrigger delay={350} render={children} />
    <TooltipContent side="inline-end" align="start" sideOffset={8}
      className="grid w-64 max-w-[calc(100vw-24px)] items-start gap-1 rounded-md border border-border bg-popover p-2.5 text-popover-foreground shadow-md [&>:last-child]:hidden">
      <RosterMessagePreviewContent {...message} />
    </TooltipContent>
  </Tooltip>;
}

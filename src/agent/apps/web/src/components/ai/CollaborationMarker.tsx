import { BotAvatar, Button, GroupAvatar, type GroupAvatarMember } from "@mycellios/ui-web";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

/**
 * Lightweight peer event: a one-line marker ("Messaged …", "Update from …") that starts
 * collapsed. Its toggle shows the exchanged text (`body`) and, through `replies`, the peer
 * run's folded replies; without `replies` the marker keeps its own open state.
 */
export function CollaborationMarker({
  ariaLabel,
  color,
  identity,
  label,
  onClick,
  body,
  toggleLabels,
  replies,
}: {
  ariaLabel: string;
  color: string;
  identity: string;
  label: string;
  onClick: () => void;
  /** The message text, shown only while the marker is open. */
  body?: string;
  /** Accessible names of the toggle when the marker keeps its own state. */
  toggleLabels?: { expand: string; collapse: string };
  replies?: { expanded: boolean; label: string; onToggle: () => void };
}) {
  const [open, setOpen] = useState(false);
  const hasToggle = Boolean(replies || (body && toggleLabels));
  const expanded = replies ? replies.expanded : open;
  const toggleLabel = replies?.label ?? (expanded ? toggleLabels?.collapse : toggleLabels?.expand) ?? "";
  return (
    <div className="flex flex-col items-start">
      <div className="flex max-w-full justify-start">
        <button
          type="button"
          data-testid="peer-receipt-chip"
          aria-label={ariaLabel}
          onClick={onClick}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground/75"
        >
          <BotAvatar color={color} identity={identity} size={16} />
          <span dir="auto" className="truncate">
            {label}
          </span>
        </button>
        {hasToggle ? (
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="peer-replies-toggle"
            aria-expanded={expanded}
            aria-label={toggleLabel}
            onClick={replies ? replies.onToggle : () => setOpen((value) => !value)}
            className="rounded-full text-muted-foreground"
          >
            <ChevronDown
              size={14}
              strokeWidth={1.8}
              className={
                expanded
                  ? "size-3.5 transition-transform"
                  : "size-3.5 -rotate-90 transition-transform"
              }
              aria-hidden="true"
            />
          </Button>
        ) : null}
      </div>
      {expanded && body ? (
        <p
          data-testid="peer-message-body"
          dir="auto"
          className="ms-9 mt-0.5 max-w-[42rem] whitespace-pre-wrap break-words border-s border-border ps-3 text-[13px] text-muted-foreground"
        >
          {body}
        </p>
      ) : null}
    </div>
  );
}

/** The working bot with what it is doing right now, such as its current tool call. */
export function ActiveBotGlyph({ bots, label }: { bots: GroupAvatarMember[]; label: string }) {
  return (
    <div role="status" className="flex min-h-10 min-w-0 items-center gap-2.5 px-1">
      <GroupAvatar members={bots} size={28} />
      <span dir="auto" className="min-w-0 truncate text-[15px] text-muted-foreground text-shimmer">
        {label}
      </span>
    </div>
  );
}

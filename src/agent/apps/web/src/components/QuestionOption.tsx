import { Check, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

export function QuestionOption({
  letter,
  children,
  onClick,
  disabled,
  busy = false,
  selected,
  accessibleLabel,
}: {
  letter: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  selected?: boolean;
  accessibleLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-label={accessibleLabel}
      aria-busy={busy || undefined}
      aria-pressed={selected}
      className={`group flex min-h-11 w-full min-w-0 items-center gap-3 rounded-lg px-1 py-2 text-start text-[14px] leading-5 text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-60 ${selected ? "bg-primary/10" : "enabled:hover:bg-foreground/5 enabled:active:bg-foreground/10"}`}
    >
      <span
        aria-hidden="true"
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border text-xs font-medium leading-none ${selected ? "border-primary/25 bg-primary/10 text-primary" : "border-border bg-background/50 text-muted-foreground"}`}
      >
        {letter}
      </span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
      {busy ? (
        <LoaderCircle
          aria-hidden="true"
          size={16}
          className="shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
        />
      ) : selected ? (
        <Check aria-hidden="true" size={16} className="shrink-0 text-primary" />
      ) : null}
    </button>
  );
}

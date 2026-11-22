import { Button, cn } from "@mycellios/ui-web";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

/** Shared first-run pieces: one centered heading, grouped rows in a card and a quiet back link. */
export function OnboardingHeading({ title, description, id }: { title: ReactNode; description?: ReactNode; id?: string }) {
  return (
    <header className="text-center">
      <h1 id={id} className="text-[28px] leading-tight font-semibold tracking-tight text-foreground sm:text-[32px]">
        {title}
      </h1>
      {description ? <p className="mx-auto mt-3 max-w-[420px] text-[15px] leading-relaxed text-muted-foreground">{description}</p> : null}
    </header>
  );
}

export function ChoiceList({ children, className, ...props }: ComponentProps<"div">) {
  return (
    <div {...props} className={cn("w-full overflow-hidden rounded-xl border border-border bg-card text-start [&>*+*]:border-t [&>*+*]:border-border", className)}>
      {children}
    </div>
  );
}

const rowClass =
  "h-auto w-full justify-between gap-3 rounded-none border-0 px-4 py-3.5 text-start font-normal whitespace-normal hover:bg-muted aria-pressed:bg-muted";

/** A row of a ChoiceList. A pressed row is a selection; any other row moves on. */
export function ChoiceRow({
  title,
  detail,
  badge,
  trailing,
  pressed,
  busy,
  className,
  ...props
}: Omit<ComponentProps<"button">, "title"> & {
  title: ReactNode;
  detail?: ReactNode;
  badge?: ReactNode;
  trailing?: ReactNode;
  pressed?: boolean;
  busy?: ReactNode;
}) {
  return (
    <Button type="button" variant="ghost" aria-pressed={pressed} className={cn(rowClass, className)} {...props}>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <strong className="font-semibold text-foreground">{title}</strong>
          {badge ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{badge}</span>
          ) : null}
        </span>
        {detail ? <span className="text-sm text-muted-foreground">{detail}</span> : null}
      </span>
      <span className="ms-auto flex shrink-0 items-center gap-2">
        {trailing}
        {busy ??
          (pressed === undefined ? (
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          ) : (
            <Check className={cn("size-4 text-foreground", !pressed && "invisible")} aria-hidden="true" />
          ))}
      </span>
    </Button>
  );
}

export function BackLink({ children, className, ...props }: ComponentProps<"button">) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("-ms-2 h-8 gap-1 px-2 font-normal text-muted-foreground hover:text-foreground", className)}
      {...props}
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      {children}
    </Button>
  );
}

/** A quiet surface for forms, matching the ChoiceList card. */
export function OnboardingCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border border-border bg-card p-5", className)}>{children}</div>;
}

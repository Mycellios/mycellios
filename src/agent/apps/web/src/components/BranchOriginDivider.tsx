import { useLingui } from "@lingui/react/macro";
import { Split } from "lucide-react";

/**
 * Where the copied history of a branched conversation ends. It names the conversation the copy
 * came from and opens it at the turn the branch started from, unless that conversation is gone.
 * The lines are decoration; the label (a button when it opens the source) is what is read out.
 */
export function BranchOriginDivider({
  messageId,
  source,
  onOpen,
}: {
  messageId: string;
  source: { kind: "main" } | { kind: "conversation"; title: string } | { kind: "deleted" };
  onOpen?: () => void;
}) {
  const { t } = useLingui();
  const name =
    source.kind === "main"
      ? t`Main chat`
      : source.kind === "conversation"
        ? source.title || t`New conversation`
        : "";
  const label =
    source.kind === "deleted" ? t`Branched from a deleted conversation` : t`Branched from ${name}`;
  return (
    <div
      data-message-id={messageId}
      data-testid="branch-origin-divider"
      data-branch-source={source.kind}
      className="my-6 flex select-none items-center gap-4 text-xs text-muted-foreground"
    >
      <span className="h-px flex-1 bg-border" aria-hidden />
      {onOpen && source.kind !== "deleted" ? (
        <button
          type="button"
          onClick={onOpen}
          title={t`Open where this branch started`}
          className="inline-flex min-w-0 max-w-[70%] items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Split size={13} aria-hidden className="shrink-0" />
          <span className="truncate" dir="auto">
            {label}
          </span>
        </button>
      ) : (
        <span className="inline-flex min-w-0 max-w-[70%] items-center gap-1.5">
          <Split size={13} aria-hidden className="shrink-0" />
          <span className="truncate" dir="auto">
            {label}
          </span>
        </span>
      )}
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}

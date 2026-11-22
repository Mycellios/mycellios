import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { TranscriptEmptyAvatar } from "../pages/shell/transcript-empty-avatar";

/** The empty view of a draft tab: nothing exists yet, and the main chat is left alone. */
export function NewConversationIntro({ bot }: { bot: { id: string; name: string; color: string } }) {
  const { t } = useLingui();
  const name = bot.name;
  return <div data-testid="new-conversation-draft" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-6 pb-16 pt-12 text-center">
    <TranscriptEmptyAvatar bot={bot} />
    <h2 className="font-display text-2xl tracking-tight" dir="auto">{t`New conversation with ${name}`}</h2>
    <p className="max-w-sm text-sm leading-relaxed text-muted-foreground" dir="auto">
      {t`Your first message starts it. The main chat with ${name} stays as it is.`}
    </p>
  </div>;
}

/** Shown at the top of a conversation the Mico opened by itself. */
export function MicoStartedBanner({ name, icon }: { name: string; icon?: ReactNode }) {
  const { t } = useLingui();
  return <p data-testid="conversation-started-by-mico" dir="auto"
    className="mx-auto mb-3 flex max-w-xl items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">
    {icon}{t`${name} opened this conversation`}
  </p>;
}

/** A conversation's last turn failed; the next turn clears it. */
export function ConversationFailureCard({ error }: { error: string | null | undefined }) {
  const { t } = useLingui();
  const reason = Array.from(error?.trim() ?? "").slice(0, 2000).join("");
  return <div role="status" data-testid="conversation-failure"
    className="mx-auto mt-3 w-full max-w-xl rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
    <p className="font-medium text-destructive">{t`This conversation stopped with an error`}</p>
    <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground" dir="auto">
      {reason || t`No reason was given. Send a message to try again.`}
    </p>
  </div>;
}

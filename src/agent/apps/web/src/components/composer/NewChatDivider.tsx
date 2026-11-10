import { useLingui } from "@lingui/react/macro";
export function NewChatDivider({ messageId }: { messageId: string }) {
  const { t } = useLingui();
  return <div data-message-id={messageId} data-testid="new-chat-divider" role="separator" aria-label={t`New chat`}
    className="my-6 flex select-none items-center gap-4 text-xs text-muted-foreground">
    <span className="h-px flex-1 bg-border" aria-hidden/><span>{t`New chat`}</span><span className="h-px flex-1 bg-border" aria-hidden/>
  </div>;
}

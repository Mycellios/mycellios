import { useLingui } from "@lingui/react/macro";
import { Button } from "@mycellios/ui-web";
import { MessageCircle } from "lucide-react";
import { useInRouterContext, useNavigate } from "react-router-dom";

type ThreadLink = { botId: string; threadId: string; title: string };

function useOpenThread(link: ThreadLink) {
  const navigate = useNavigate();
  return () => navigate({ pathname: `/app/${encodeURIComponent(link.botId)}`, search: `task=${encodeURIComponent(link.threadId)}` });
}

function LinkButton({ link, label }: { link: ThreadLink; label: string }) {
  const open = useOpenThread(link);
  return <Button type="button" variant="outline" size="sm" data-testid="thread-link" onClick={open}
    className="h-8 max-w-full gap-1.5 rounded-full px-3 font-normal">
    <MessageCircle size={14} aria-hidden="true" />
    <span className="min-w-0 truncate" dir="auto">{label}</span>
  </Button>;
}

/** A message that points at another conversation of the same Mico opens it. */
export function ThreadLinkChip(link: ThreadLink) {
  const { t } = useLingui();
  const inRouter = useInRouterContext();
  const name = link.title || t`New conversation`;
  const label = t`Open conversation ${name}`;
  if (!inRouter) return <span data-testid="thread-link" className="inline-flex max-w-full items-center gap-1.5 text-sm text-muted-foreground">
    <MessageCircle size={14} aria-hidden="true" /><span className="truncate" dir="auto">{label}</span>
  </span>;
  return <LinkButton link={link} label={label} />;
}

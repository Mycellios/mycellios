import { Trans, useLingui } from "@lingui/react/macro";
import type { ThreadSearchOutput } from "@mycellios/contracts";
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from "@mycellios/ui-web";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { RpcClient } from "../lib/rpc";

type SearchTarget = { botId: string; taskThreadId?: string } | { groupId: string };

/**
 * Search messages in the open conversation. Matches come newest first; Previous moves to an
 * older match and Next to a newer one, and each move jumps the transcript to that message.
 */
export function ChatSearchButton({
  rpc,
  scope,
  target,
  threadId,
  onJump,
}: {
  rpc: RpcClient;
  scope: string;
  target: SearchTarget;
  threadId: string;
  onJump: (messageId: string) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [text]);
  const search = useQuery({
    queryKey: ["chat-search", scope, threadId, query],
    enabled: open && query.length > 0,
    queryFn: (): Promise<ThreadSearchOutput> => rpc.threads.searchMessages({ ...target, q: query }),
    staleTime: 10_000,
  });
  const matches = search.data && search.data.threadId === threadId ? search.data.matches : [];
  // A new query starts at the newest match and jumps to it.
  useEffect(() => {
    setIndex(0);
    if (matches[0]) onJump(matches[0].messageId);
  }, [search.data]);
  const go = (next: number) => {
    if (!matches.length) return;
    const wrapped = (next + matches.length) % matches.length;
    setIndex(wrapped);
    onJump(matches[wrapped]!.messageId);
  };
  const older = () => go(index + 1);
  const newer = () => go(index - 1);
  const count = matches.length;
  const current = count ? index + 1 : 0;
  const more = Boolean(search.data?.more);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setText("");
          setQuery("");
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            aria-label={t`Search messages`}
            title={t`Search messages`}
          />
        }
      >
        <Search size={16} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] gap-2 p-2">
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (event.shiftKey) newer();
              else older();
            }}
            maxLength={200}
            placeholder={t`Search messages`}
            aria-label={t`Search messages`}
            className="h-8 min-w-0 flex-1"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t`Previous match`}
            title={t`Previous match`}
            disabled={count < 2}
            onClick={older}
          >
            <ChevronUp size={16} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t`Next match`}
            title={t`Next match`}
            disabled={count < 2}
            onClick={newer}
          >
            <ChevronDown size={16} aria-hidden="true" />
          </Button>
        </div>
        <p role="status" className="px-1 text-xs text-muted-foreground">
          {!query ? (
            <Trans>Type to search this conversation.</Trans>
          ) : search.isPending ? (
            <Trans>Searching…</Trans>
          ) : search.isError ? (
            <Trans>Could not search this conversation.</Trans>
          ) : count === 0 ? (
            <Trans>No messages match.</Trans>
          ) : more ? (
            <Trans>
              {current} of {count}+
            </Trans>
          ) : (
            <Trans>
              {current} of {count}
            </Trans>
          )}
        </p>
        {count > 0 ? (
          <p className="line-clamp-2 px-1 text-xs text-foreground/80" dir="auto">
            {matches[index]?.snippet}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

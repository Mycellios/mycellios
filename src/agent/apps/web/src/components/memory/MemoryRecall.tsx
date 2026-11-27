import { Trans, useLingui } from "@lingui/react/macro";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from "@mycellios/ui-web";
import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import { noteFolder, noteTitle } from "../../lib/memory-vault";
import { useSpaceQueries } from "../../lib/query";

type MemoryRecallActions = { show: (messageId: string) => void };

/** Present only in a person's own Mico chats, where replies may carry local memory. */
export const MemoryRecallContext = createContext<MemoryRecallActions | null>(null);

export function useMemoryRecall() {
  return useContext(MemoryRecallContext);
}

/**
 * "Memory in context" for a Mico reply: the notes its run placed in the prompt, as the run
 * recorded them. It lists what the Mico had available, not a claim about what it used.
 */
export function MemoryRecallGate({
  enabled,
  children,
  botName,
  onOpenNote,
}: {
  /** Only a person's own Mico chats offer it; groups and shared chats never do. */
  enabled: boolean;
  children: ReactNode;
  botName?: string;
  onOpenNote: (id: string) => void;
}) {
  const [messageId, setMessageId] = useState<string | null>(null);
  const actions = useMemo<MemoryRecallActions>(() => ({ show: setMessageId }), []);
  return (
    // The provider always renders, so turning the offer off never remounts the transcript.
    <MemoryRecallContext.Provider value={enabled ? actions : null}>
      {children}
      {enabled && messageId ? (
        <MemoryRecallDialog
          messageId={messageId}
          botName={botName}
          onClose={() => setMessageId(null)}
          onOpenNote={(id) => {
            setMessageId(null);
            onOpenNote(id);
          }}
        />
      ) : null}
    </MemoryRecallContext.Provider>
  );
}

function MemoryRecallDialog({
  messageId,
  botName,
  onClose,
  onOpenNote,
}: {
  messageId: string;
  botName?: string;
  onClose: () => void;
  onOpenNote: (id: string) => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const recall = useQuery({
    ...queries.memory.recall.queryOptions({ input: { messageId } }),
    staleTime: 30_000,
    retry: 1,
  });
  const data = recall.data;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-testid="memory-recall-dialog">
        <DialogHeader>
          <DialogTitle>
            <Trans>Memory in context</Trans>
          </DialogTitle>
          <DialogDescription>
            {botName
              ? t`Notes ${botName} had available when writing this reply. Having a note does not mean the reply relied on it.`
              : t`Notes the Mico had available when writing this reply. Having a note does not mean the reply relied on it.`}
          </DialogDescription>
        </DialogHeader>
        {recall.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : recall.isError ? (
          <div className="space-y-2">
            <p className="text-[13px] text-destructive" role="alert">
              <Trans>Could not load the notes for this reply.</Trans>
            </p>
            <Button variant="secondary" size="sm" onClick={() => void recall.refetch()}>
              <Trans>Try again</Trans>
            </Button>
          </div>
        ) : !data?.recorded ? (
          <p className="text-[13px] text-muted-foreground">
            <Trans>
              No memory notes were recorded for this reply. Replies written before this feature, or
              without saved notes, show nothing here.
            </Trans>
          </p>
        ) : (
          <div className="space-y-3">
            {data.notes.length ? (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {data.notes.map((note) => (
                  <li key={note.id}>
                    <Button
                      variant="ghost"
                      className="h-auto w-full justify-start rounded-none px-3 py-2 text-start"
                      onClick={() => onOpenNote(note.id)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm" dir="auto">
                          {noteTitle(note.path)}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground" dir="auto">
                          {note.scope === "user" ? t`General` : t`This Mico`}
                          {noteFolder(note.path) ? ` / ${noteFolder(note.path)}` : ""}
                        </span>
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            {data.removed > 0 ? (
              <p className="text-xs text-muted-foreground">{t`${data.removed} more notes were deleted since.`}</p>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

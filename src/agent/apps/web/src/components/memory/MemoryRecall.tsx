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
import { Brain } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { noteFolder, noteTitle } from "../../lib/memory-vault";
import { useSpaceQueries } from "../../lib/query";
import { useSpaceRpc } from "../../lib/space-rpc";

const COUNT_BATCH = 100;

type CountStore = {
  /** The recorded count, null when the reply has none, undefined while unknown. */
  get: (messageId: string) => number | null | undefined;
  request: (messageId: string) => void;
  subscribe: (listener: () => void) => () => void;
};

type MemoryRecallActions = { show: (messageId: string) => void; counts: CountStore };

/**
 * Reads the counts for every reply on screen in one request per tick (at most 100 ids each),
 * instead of one request per message. Unknown and failed reads simply show nothing.
 */
export function createCountStore(
  read: (ids: string[]) => Promise<Record<string, number>>,
): CountStore {
  const known = new Map<string, number | null>();
  const pending = new Set<string>();
  const listeners = new Set<() => void>();
  let scheduled = false;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const flush = () => {
    scheduled = false;
    const ids = [...pending];
    pending.clear();
    for (let start = 0; start < ids.length; start += COUNT_BATCH) {
      const batch = ids.slice(start, start + COUNT_BATCH);
      read(batch)
        .then((counts) => {
          for (const id of batch) known.set(id, counts[id] ?? null);
          notify();
        })
        .catch(() => {
          for (const id of batch) known.set(id, null);
          notify();
        });
    }
  };
  return {
    get: (id) => known.get(id),
    request: (id) => {
      if (known.has(id) || pending.has(id)) return;
      pending.add(id);
      if (!scheduled) {
        scheduled = true;
        setTimeout(flush, 0);
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

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
  const rpc = useSpaceRpc();
  const actions = useMemo<MemoryRecallActions>(
    () => ({
      show: setMessageId,
      counts: createCountStore(
        async (messageIds) => (await rpc.memory.recallCounts({ messageIds })).counts,
      ),
    }),
    [rpc],
  );
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

/**
 * A small line under a finished Mico reply: how many notes it had in context. It opens the
 * same list as "Memory in context". Nothing shows for replies without a recorded count.
 */
export function MemoryRecallChip({ messageId }: { messageId: string }) {
  const { t } = useLingui();
  const recall = useMemoryRecall();
  const store = recall?.counts;
  const subscribe = useCallback(
    (listener: () => void) => (store ? store.subscribe(listener) : () => {}),
    [store],
  );
  const count = useSyncExternalStore(subscribe, () => store?.get(messageId));
  useEffect(() => {
    store?.request(messageId);
  }, [store, messageId]);
  if (!recall || !count) return null;
  return (
    <button
      type="button"
      data-testid="memory-recall-chip"
      className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      onClick={() => recall.show(messageId)}
    >
      <Brain size={12} strokeWidth={1.8} aria-hidden />
      {count === 1 ? t`1 note in context` : t`${count} notes in context`}
    </button>
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

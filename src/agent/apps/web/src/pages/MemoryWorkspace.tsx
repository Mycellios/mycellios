import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, MemoryDocument } from "@mycellios/contracts";
import { memoryNotePath } from "@mycellios/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  parseBotAvatar,
  resolvePersonaColorDef,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from "@mycellios/ui-web";
import { ORPCError } from "@orpc/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Download,
  FilePlus2,
  FileText,
  Folder,
  Menu,
  Network,
  Search,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { IconTooltip } from "../components/IconTooltip";
import { MemoryGraph } from "../components/memory/MemoryGraph";
import {
  EmptyMemoryNote,
  MemoryNote,
  type MemoryNoteSource,
} from "../components/memory/MemoryNote";
import { downloadArtifactBytes } from "../lib/artifact-open";
import { desktopDragClass } from "../lib/desktop";
import {
  buildVaultGraph,
  createLinkResolver,
  folderTree,
  matchesVaultQuery,
  neighbourhood,
  noteFolder,
  noteTitle,
  subgraph,
  type VaultFolder,
  type VaultGraphNode,
  type VaultNote,
  vaultDisplayPath,
  vaultGroupKey,
} from "../lib/memory-vault";
import {
  type ImportItem,
  readVaultFiles,
  type VaultFile,
  type VaultGroupChoice,
  vaultExportFiles,
  vaultImportPlan,
  vaultZip,
} from "../lib/memory-vault-files";
import { fetchFresh, useSpaceQueries, writeSaved } from "../lib/query";
import { useSpaceRpc } from "../lib/space-rpc";

const NO_NOTES: MemoryDocument[] = [];
const FULL_GRAPH_LIMIT = 2000;
type Mode = "notes" | "graph";

/**
 * The memory page: every note the person's Micos keep in this Space, as a vault. A note
 * tree on the left, the open note in the middle with its links and backlinks, and its local
 * graph beside it; the graph mode shows how all notes connect. Reading and editing use the
 * same owner-scoped memory routes as Settings, so nothing here changes what a Mico receives
 * except the person's own edits.
 */
export type MemoryConversationSource = {
  threadId: string;
  kind: "main" | "conversation" | "group";
  botId: string | null;
  groupId: string | null;
};

export function MemoryWorkspace({
  bots,
  onOpenNavigation,
  onOpenConversation,
}: {
  bots: readonly Bot[];
  onOpenNavigation?: () => void;
  onOpenConversation?: (source: MemoryConversationSource) => void;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const list = queries.memory.list.queryOptions({ input: { includeTasks: true } });
  // Micos write memory as they work, so every visit reads it again behind the cached list.
  const listQuery = useQuery({ ...list, refetchOnMount: "always" });
  const notes = listQuery.data ?? NO_NOTES;
  const selectedId = searchParams.get("note");
  const mode: Mode = searchParams.get("memory") === "graph" ? "graph" : "notes";
  const [query, setQuery] = useState("");
  const [hiddenGroups, setHiddenGroups] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [loadedRevision, setLoadedRevision] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicted, setConflicted] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pendingOpen, setPendingOpen] = useState<{ id: string | null; mode?: Mode } | null>(null);
  const [creating, setCreating] = useState<{ name: string; group: string } | null>(null);
  const [importing, setImporting] = useState<VaultFile[] | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const botById = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);
  const groupLabel = useCallback(
    (group: string) => (group === "general" ? t`General` : (botById.get(group)?.name ?? t`Mico`)),
    [botById, t],
  );
  const groupColors = useMemo(() => {
    const colors = new Map<string, string>();
    for (const bot of bots) {
      const parsed = parseBotAvatar(bot.color, bot.id);
      colors.set(
        bot.id,
        resolvePersonaColorDef(bot.id || parsed.color || "agent", parsed.color).hex,
      );
    }
    return colors;
  }, [bots]);
  const [generalColor, setGeneralColor] = useState("#3d5a47");
  useEffect(() => {
    const value = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
    if (value) setGeneralColor(value);
  }, []);
  const colorFor = useCallback(
    (node: VaultGraphNode) =>
      node.group === "general" ? generalColor : (groupColors.get(node.group) ?? generalColor),
    [generalColor, groupColors],
  );

  const conversationsLabel = t`Conversation notes`;
  const untitledConversation = t`Untitled conversation`;
  const displayPath = useCallback(
    (note: VaultNote) => vaultDisplayPath(note, conversationsLabel, untitledConversation),
    [conversationsLabel, untitledConversation],
  );
  const resolve = useMemo(() => createLinkResolver(notes), [notes]);
  const graph = useMemo(() => buildVaultGraph(notes), [notes]);
  const byId = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
  const matches = useMemo(
    () =>
      query.trim()
        ? new Set(notes.filter((note) => matchesVaultQuery(note, query)).map((note) => note.id))
        : null,
    [notes, query],
  );
  const groups = useMemo(() => {
    const byGroup = new Map<string, VaultNote[]>();
    for (const note of notes) {
      const key = vaultGroupKey(note);
      (byGroup.get(key) ?? byGroup.set(key, []).get(key)!).push(note);
    }
    const keys = [...byGroup.keys()].sort((a, b) =>
      a === "general" ? -1 : b === "general" ? 1 : groupLabel(a).localeCompare(groupLabel(b)),
    );
    return keys.map((key) => ({ key, notes: byGroup.get(key)! }));
  }, [notes, groupLabel]);

  const dirty = editing && selected !== null && draft !== selected.content;
  const setParams = (next: { id?: string | null; mode?: Mode }) => {
    const params = new URLSearchParams(searchParams);
    if (next.id !== undefined) {
      if (next.id) params.set("note", next.id);
      else params.delete("note");
    }
    if (next.mode !== undefined) {
      if (next.mode === "graph") params.set("memory", "graph");
      else params.delete("memory");
    }
    setSearchParams(params, { replace: true });
  };
  function resetEditor() {
    setEditing(false);
    setConflicted(false);
    setConfirmingDelete(false);
    setError(null);
  }
  /** Leaving a note with unsaved text asks first; the draft is never dropped silently. */
  function go(id: string | null, nextMode?: Mode) {
    if (dirty && id !== selectedId) {
      setPendingOpen({ id, mode: nextMode });
      return;
    }
    if (id !== selectedId) resetEditor();
    setParams({ id, ...(nextMode ? { mode: nextMode } : {}) });
  }
  const openNote = (id: string) => (byId.has(id) ? go(id, "notes") : undefined);

  function setNotes(update: (current: MemoryDocument[]) => MemoryDocument[]) {
    return writeSaved(queryClient, list.queryKey, (current) => update(current ?? []));
  }
  function startEdit() {
    if (!selected) return;
    setDraft(selected.content);
    setLoadedRevision(selected.revision);
    setConflicted(false);
    setConfirmingDelete(false);
    setError(null);
    setEditing(true);
  }
  async function save() {
    if (!selected || busy || conflicted) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await rpc.memory.update({
        documentId: selected.id,
        content: draft,
        expectedRevision: loadedRevision,
      });
      await setNotes((current) => current.map((note) => (note.id === updated.id ? updated : note)));
      setEditing(false);
    } catch (err) {
      if (err instanceof ORPCError && err.code === "CONFLICT") {
        setConflicted(true);
        await fetchFresh(queryClient, list).catch(() => undefined);
      } else setError(t`Could not save`);
    } finally {
      setBusy(false);
    }
  }
  async function toggleEssential() {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await rpc.memory.update({
        documentId: selected.id,
        content: selected.content,
        expectedRevision: selected.revision,
        inclusion: selected.inclusion === "essential" ? "searchable" : "essential",
      });
      await setNotes((current) => current.map((note) => (note.id === updated.id ? updated : note)));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t`Could not save`);
      await fetchFresh(queryClient, list).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!selected || busy) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await rpc.memory.remove({ documentId: selected.id });
      await setNotes((current) => current.filter((note) => note.id !== selected.id));
      resetEditor();
      setParams({ id: null });
    } catch {
      setError(t`Could not remove`);
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    if (!selected) return;
    try {
      const latest = (await fetchFresh(queryClient, list)).find((note) => note.id === selected.id);
      if (!latest) throw new Error("Note unavailable");
      downloadArtifactBytes(
        latest.path.split("/").at(-1) ?? latest.path,
        "text/markdown",
        new TextEncoder().encode(latest.content),
      );
    } catch {
      setError(t`Could not load`);
    }
  }

  const backlinks = selected
    ? (graph.backlinks.get(selected.id) ?? []).flatMap((id) => byId.get(id) ?? [])
    : [];
  const outgoing = selected
    ? (graph.outgoing.get(selected.id) ?? []).flatMap((id) => byId.get(id) ?? [])
    : [];
  const localGraph = useMemo(
    () => (selected ? subgraph(graph, neighbourhood(graph, selected.id, 1)) : null),
    [graph, selected],
  );
  const fullGraph = useMemo(() => {
    const keep = new Set(
      graph.nodes
        .filter((node) => (node.ghost ? true : !hiddenGroups.has(node.group)))
        .map((node) => node.id),
    );
    const visible = subgraph(graph, keep);
    // A ghost stays only while a visible note still links to it.
    const linked = new Set(visible.edges.flatMap((edge) => [edge.source, edge.target]));
    return subgraph(
      visible,
      new Set(
        visible.nodes.filter((node) => !node.ghost || linked.has(node.id)).map((node) => node.id),
      ),
    );
  }, [graph, hiddenGroups]);
  const tooLarge = fullGraph.nodes.length > FULL_GRAPH_LIMIT;

  const sourcesQuery = useQuery({
    ...queries.memory.sources.queryOptions({ input: { documentId: selected?.id ?? "" } }),
    enabled: Boolean(selected),
    staleTime: 30_000,
    retry: 1,
  });
  const sources = useMemo<MemoryNoteSource[] | undefined>(
    () =>
      sourcesQuery.data?.sources.map((source) => {
        const botName = source.botId ? botById.get(source.botId)?.name : undefined;
        const label =
          source.kind === "main"
            ? botName
              ? t`Main chat with ${botName}`
              : t`Main chat`
            : source.title?.trim() ||
              (source.kind === "group" ? t`Group conversation` : untitledConversation);
        return {
          key: source.threadId,
          label,
          archived: source.archived,
          onOpen: () => onOpenConversation?.(source),
        };
      }),
    [sourcesQuery.data, botById, onOpenConversation, t, untitledConversation],
  );

  const newNote = (name = "", group = selected ? vaultGroupKey(selected) : "general") =>
    setCreating({ name, group });
  const groupChoices: VaultGroupChoice[] = [
    { key: "general", label: t`General` },
    ...bots.map((bot) => ({ key: bot.id, label: bot.name })),
  ];

  async function exportVault() {
    setTransferError(null);
    try {
      const latest = await fetchFresh(queryClient, list);
      const byGroup = new Map<string, VaultNote[]>();
      for (const note of latest) {
        const key = vaultGroupKey(note);
        (byGroup.get(key) ?? byGroup.set(key, []).get(key)!).push(note);
      }
      const files = vaultExportFiles(
        [...byGroup.entries()].map(([key, groupNotes]) => ({
          label: groupLabel(key),
          notes: groupNotes.map((note) => ({ path: displayPath(note), content: note.content })),
        })),
      );
      const date = new Date().toISOString().slice(0, 10);
      downloadArtifactBytes(`memory-${date}.zip`, "application/zip", await vaultZip(files));
    } catch {
      setTransferError(t`Could not export your memory.`);
    }
  }
  async function pickImport(picked: FileList | null) {
    setTransferError(null);
    if (!picked?.length) return;
    try {
      setImporting(await readVaultFiles([...picked]));
    } catch {
      setTransferError(t`Could not read those files.`);
    }
  }

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground"
      data-testid="memory-workspace"
    >
      <header
        className={`${desktopDragClass()} rk-window-buttons-clear border-b border-border px-4 py-3 md:px-6`}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-2">
            {onOpenNavigation ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t`Open navigation`}
                onClick={onOpenNavigation}
                className="app-no-drag md:hidden"
              >
                <Menu aria-hidden />
              </Button>
            ) : null}
            <h1 className="text-heading2 font-semibold">
              <Trans>Memory</Trans>
            </h1>
          </div>
          <div className="app-no-drag ms-auto flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full">
            <ToggleGroup
              aria-label={t`Memory view`}
              value={[mode]}
              onValueChange={([next]) => {
                if (next === "notes" || next === "graph") go(selectedId, next);
              }}
              spacing={1}
              size="sm"
              className="rounded-lg border border-border p-0.5"
            >
              <IconTooltip label={t`Notes`}>
                <ToggleGroupItem
                  value="notes"
                  aria-label={t`Notes`}
                  className="size-7 min-w-7 rounded-md px-0 text-muted-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                >
                  <FileText size={15} strokeWidth={1.9} />
                </ToggleGroupItem>
              </IconTooltip>
              <IconTooltip label={t`Graph`}>
                <ToggleGroupItem
                  value="graph"
                  aria-label={t`Graph`}
                  className="size-7 min-w-7 rounded-md px-0 text-muted-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                >
                  <Network size={15} strokeWidth={1.9} />
                </ToggleGroupItem>
              </IconTooltip>
            </ToggleGroup>
            <div className="relative min-w-36 flex-1 sm:w-64 sm:flex-none">
              <Search
                size={15}
                className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t`Search notes`}
                aria-label={t`Search notes`}
                className="ps-8"
              />
            </div>
            <IconTooltip label={t`Export as Markdown`}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t`Export as Markdown`}
                disabled={notes.length === 0}
                onClick={() => void exportVault()}
              >
                <Download aria-hidden />
              </Button>
            </IconTooltip>
            <IconTooltip label={t`Import notes`}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t`Import notes`}
                onClick={() => importInput.current?.click()}
              >
                <Upload aria-hidden />
              </Button>
            </IconTooltip>
            <input
              ref={importInput}
              type="file"
              accept=".md,.zip,text/markdown,application/zip"
              multiple
              hidden
              data-testid="memory-import-input"
              onChange={(event) => {
                void pickImport(event.target.files);
                event.target.value = "";
              }}
            />
            <Button size="sm" onClick={() => newNote()}>
              <FilePlus2 aria-hidden />
              <Trans>New note</Trans>
            </Button>
          </div>
        </div>
        {transferError ? (
          <p className="mt-2 text-[13px] text-destructive" role="alert">
            {transferError}
          </p>
        ) : null}
      </header>

      {listQuery.isPending ? (
        <div className="flex flex-1 gap-4 p-6">
          <Skeleton className="h-full w-64" />
          <Skeleton className="h-full flex-1" />
        </div>
      ) : listQuery.isError && !listQuery.data ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
          <p className="text-sm text-destructive" role="alert">
            <Trans>Could not load your memory.</Trans>
          </p>
          <Button variant="secondary" size="sm" onClick={() => void listQuery.refetch()}>
            <Trans>Try again</Trans>
          </Button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label={t`Notes`}
            className={`min-h-0 w-full shrink-0 overflow-y-auto border-border py-2 md:w-64 md:border-e ${selected && mode === "notes" ? "max-md:hidden" : ""} ${mode === "graph" ? "max-md:hidden" : ""}`}
          >
            {notes.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-muted-foreground">
                <Trans>
                  Your Micos have not saved anything yet. Notes they keep, and notes you write,
                  appear here.
                </Trans>
              </p>
            ) : null}
            {groups.map((group) => (
              <VaultSection
                key={group.key}
                label={groupLabel(group.key)}
                color={
                  group.key === "general"
                    ? generalColor
                    : (groupColors.get(group.key) ?? generalColor)
                }
                tree={folderTree(
                  group.notes
                    .filter((note) => !matches || matches.has(note.id))
                    .map((note) =>
                      note.taskThreadId ? { ...note, path: displayPath(note) } : note,
                    ),
                )}
                selectedId={selectedId}
                onOpen={(id) => go(id, "notes")}
              />
            ))}
            {matches && matches.size === 0 && notes.length ? (
              <p className="px-4 py-3 text-[13px] text-muted-foreground">
                <Trans>No notes match your search.</Trans>
              </p>
            ) : null}
          </nav>

          {mode === "graph" ? (
            <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t`Graph`}>
              <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
                {groups.map((group) => {
                  const hidden = hiddenGroups.has(group.key);
                  return (
                    <Button
                      key={group.key}
                      variant={hidden ? "ghost" : "outline"}
                      size="sm"
                      aria-pressed={!hidden}
                      onClick={() =>
                        setHiddenGroups((current) => {
                          const next = new Set(current);
                          if (next.has(group.key)) next.delete(group.key);
                          else next.add(group.key);
                          return next;
                        })
                      }
                      className={hidden ? "text-muted-foreground" : ""}
                    >
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{
                          background:
                            group.key === "general"
                              ? generalColor
                              : (groupColors.get(group.key) ?? generalColor),
                          opacity: hidden ? 0.4 : 1,
                        }}
                      />
                      <span className="truncate" dir="auto">
                        {groupLabel(group.key)}
                      </span>
                    </Button>
                  );
                })}
                <span className="ms-auto text-xs text-muted-foreground">
                  {t`${fullGraph.nodes.filter((node) => !node.ghost).length} notes · ${fullGraph.edges.length} links`}
                </span>
              </div>
              {tooLarge ? (
                <p className="p-6 text-sm text-muted-foreground">
                  <Trans>
                    There are too many notes to draw at once. Hide some groups or open a note to see
                    its own links.
                  </Trans>
                </p>
              ) : fullGraph.nodes.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  <Trans>Nothing to show. Notes appear here as your Micos remember things.</Trans>
                </p>
              ) : (
                <MemoryGraph
                  className="flex-1"
                  nodes={fullGraph.nodes}
                  edges={fullGraph.edges}
                  colorFor={colorFor}
                  selectedId={selectedId}
                  highlighted={matches}
                  onOpen={(id) =>
                    byId.has(id)
                      ? openNote(id)
                      : newNote(graph.nodes.find((node) => node.id === id)?.label ?? "")
                  }
                />
              )}
              {fullGraph.edges.length === 0 && fullGraph.nodes.length > 0 ? (
                <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                  <Trans>Notes connect when one mentions another as [[note name]].</Trans>
                </p>
              ) : null}
            </section>
          ) : (
            <>
              <div className={`flex min-h-0 min-w-0 flex-1 ${selected ? "" : "max-md:hidden"}`}>
                {selected ? (
                  <MemoryNote
                    key={selected.id}
                    note={selected}
                    locationLabel={groupLabel(vaultGroupKey(selected))}
                    displayFolder={
                      selected.taskThreadId ? noteFolder(displayPath(selected)) : undefined
                    }
                    sources={sources}
                    notes={notes}
                    resolve={resolve}
                    backlinks={backlinks}
                    outgoing={outgoing}
                    editing={editing}
                    draft={draft}
                    busy={busy}
                    error={error}
                    conflicted={conflicted}
                    confirmingDelete={confirmingDelete}
                    onDraft={setDraft}
                    onEdit={startEdit}
                    onCancel={resetEditor}
                    onSave={() => void save()}
                    onToggleEssential={() => void toggleEssential()}
                    onDownload={() => void download()}
                    onDelete={() => void remove()}
                    onOpenNote={openNote}
                    onCreateFromLink={(target) => newNote(target, vaultGroupKey(selected))}
                    onBack={() => go(null)}
                  />
                ) : (
                  <EmptyMemoryNote onCreate={() => newNote()} />
                )}
              </div>
              {selected && localGraph ? (
                <aside
                  className="hidden w-72 shrink-0 flex-col border-s border-border lg:flex xl:w-80"
                  aria-label={t`Local graph`}
                >
                  <div className="flex items-center justify-between px-4 py-2">
                    <h2 className="text-xs font-medium text-muted-foreground">
                      <Trans>Connections</Trans>
                    </h2>
                    <Button variant="ghost" size="sm" onClick={() => go(selectedId, "graph")}>
                      <Network aria-hidden />
                      <Trans>Full graph</Trans>
                    </Button>
                  </div>
                  {localGraph.nodes.length > 1 ? (
                    <MemoryGraph
                      compact
                      className="flex-1"
                      nodes={localGraph.nodes}
                      edges={localGraph.edges}
                      colorFor={colorFor}
                      selectedId={selected.id}
                      onOpen={(id) =>
                        byId.has(id)
                          ? openNote(id)
                          : newNote(
                              graph.nodes.find((node) => node.id === id)?.label ?? "",
                              vaultGroupKey(selected),
                            )
                      }
                    />
                  ) : (
                    <p className="px-4 text-[13px] text-muted-foreground">
                      <Trans>
                        This note has no links yet. Mention another note as [[note name]] to connect
                        them.
                      </Trans>
                    </p>
                  )}
                </aside>
              ) : null}
            </>
          )}
        </div>
      )}

      {importing ? (
        <ImportDialog
          files={importing}
          groups={groupChoices}
          conversationsLabel={conversationsLabel}
          onClose={() => {
            setImporting(null);
            void fetchFresh(queryClient, list).catch(() => undefined);
          }}
          onCreate={async (item) => {
            try {
              await rpc.memory.create(
                item.group === "general"
                  ? { scope: "user", path: item.path, content: item.content }
                  : { scope: "bot", botId: item.group, path: item.path, content: item.content },
              );
              return "created";
            } catch (err) {
              if (err instanceof ORPCError && err.code === "CONFLICT") return "exists";
              throw err;
            }
          }}
        />
      ) : null}

      {creating ? (
        <NewNoteDialog
          initialName={creating.name}
          initialGroup={creating.group}
          groups={groupChoices}
          onClose={() => setCreating(null)}
          onCreate={async (name, group) => {
            const path = memoryNotePath(name);
            if (!path) throw new Error(t`Choose a name for the note.`);
            const created = await rpc.memory.create(
              group === "general"
                ? { scope: "user", path, content: "" }
                : { scope: "bot", botId: group, path, content: "" },
            );
            await setNotes((current) => [
              ...current.filter((note) => note.id !== created.id),
              created,
            ]);
            setCreating(null);
            resetEditor();
            setParams({ id: created.id, mode: "notes" });
            setDraft("");
            setLoadedRevision(created.revision);
            setEditing(true);
          }}
        />
      ) : null}

      <AlertDialog
        open={pendingOpen !== null}
        onOpenChange={(open) => {
          if (!open) setPendingOpen(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Discard your changes?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>This note has edits you have not saved.</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Keep editing</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = pendingOpen;
                setPendingOpen(null);
                resetEditor();
                if (target)
                  setParams({ id: target.id, ...(target.mode ? { mode: target.mode } : {}) });
              }}
            >
              <Trans>Discard</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function VaultSection({
  label,
  color,
  tree,
  selectedId,
  onOpen,
}: {
  label: string;
  color: string;
  tree: VaultFolder;
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  if (!tree.notes.length && !tree.folders.length) return null;
  return (
    <section className="mb-2">
      <h2 className="flex items-center gap-2 px-4 pt-2 pb-1 text-xs font-medium text-muted-foreground">
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate" dir="auto">
          {label}
        </span>
      </h2>
      <FolderItems folder={tree} depth={0} selectedId={selectedId} onOpen={onOpen} />
    </section>
  );
}

function FolderItems({
  folder,
  depth,
  selectedId,
  onOpen,
}: {
  folder: VaultFolder;
  depth: number;
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <ul>
      {folder.folders.map((child) => (
        <FolderNode
          key={child.path}
          folder={child}
          depth={depth}
          selectedId={selectedId}
          onOpen={onOpen}
        />
      ))}
      {folder.notes.map((note) => (
        <li key={note.id}>
          <Button
            variant="ghost"
            size="sm"
            aria-current={note.id === selectedId ? "page" : undefined}
            onClick={() => onOpen(note.id)}
            className="h-8 w-full justify-start rounded-none font-normal aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
            style={{ paddingInlineStart: `${16 + depth * 14}px` }}
          >
            <span className="truncate" dir="auto">
              {noteTitle(note.path)}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

function FolderNode({
  folder,
  depth,
  selectedId,
  onOpen,
}: {
  folder: VaultFolder;
  depth: number;
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const containsSelected = useMemo(() => {
    const walk = (entry: VaultFolder): boolean =>
      entry.notes.some((note) => note.id === selectedId) || entry.folders.some(walk);
    return walk(folder);
  }, [folder, selectedId]);
  const [open, setOpen] = useState(containsSelected);
  useEffect(() => {
    if (containsSelected) setOpen(true);
  }, [containsSelected]);
  return (
    <li>
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="h-8 w-full justify-start gap-1 rounded-none font-normal text-muted-foreground"
        style={{ paddingInlineStart: `${10 + depth * 14}px` }}
      >
        <ChevronRight
          aria-hidden
          className={`size-3.5 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
        />
        <Folder aria-hidden className="size-3.5" />
        <span className="truncate" dir="auto">
          {folder.name}
        </span>
      </Button>
      {open ? (
        <FolderItems folder={folder} depth={depth + 1} selectedId={selectedId} onOpen={onOpen} />
      ) : null}
    </li>
  );
}

function NewNoteDialog({
  initialName,
  initialGroup,
  groups,
  onClose,
  onCreate,
}: {
  initialName: string;
  initialGroup: string;
  groups: readonly { key: string; label: string }[];
  onClose: () => void;
  onCreate: (name: string, group: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const formId = useId();
  const [name, setName] = useState(initialName);
  const [group, setGroup] = useState(
    groups.some((entry) => entry.key === initialGroup) ? initialGroup : "general",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(name, group);
    } catch (err) {
      setError(
        err instanceof ORPCError && err.code === "CONFLICT"
          ? t`A note with this name already exists there.`
          : err instanceof Error && err.message
            ? err.message
            : t`Could not create the note.`,
      );
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>New note</Trans>
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label htmlFor={`${formId}-name`} className="block space-y-1 text-sm">
            <span>
              <Trans>Name</Trans>
            </span>
            <Input
              id={`${formId}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t`Trips/Japan`}
              maxLength={190}
              autoFocus
              required
            />
          </label>
          <label htmlFor={`${formId}-group`} className="block space-y-1 text-sm">
            <span>
              <Trans>Who can use it</Trans>
            </span>
            <NativeSelect
              id={`${formId}-group`}
              value={group}
              onChange={(event) => setGroup(event.target.value)}
              className="w-full"
            >
              {groups.map((entry) => (
                <NativeSelectOption key={entry.key} value={entry.key}>
                  {entry.key === "general" ? t`General (all non-isolated Micos)` : entry.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          {error ? (
            <p className="text-[13px] text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              <Trans>Create</Trans>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type ImportResult = { created: number; existing: number; skipped: number; failed: number };

/**
 * Brings Markdown notes in from files or an exported .zip. Every note is created new: a note
 * that already exists is left as it is and counted, never overwritten.
 */
function ImportDialog({
  files,
  groups,
  conversationsLabel,
  onClose,
  onCreate,
}: {
  files: readonly VaultFile[];
  groups: readonly VaultGroupChoice[];
  conversationsLabel: string;
  onClose: () => void;
  onCreate: (item: ImportItem) => Promise<"created" | "exists">;
}) {
  const { t } = useLingui();
  const formId = useId();
  const [destination, setDestination] = useState("general");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const plan = useMemo(
    () => vaultImportPlan(files, groups, destination, conversationsLabel),
    [files, groups, destination, conversationsLabel],
  );
  async function run() {
    if (busy) return;
    setBusy(true);
    const totals: ImportResult = {
      created: 0,
      existing: 0,
      skipped: plan.skipped.length,
      failed: 0,
    };
    for (const [index, item] of plan.items.entries()) {
      try {
        if ((await onCreate(item)) === "created") totals.created += 1;
        else totals.existing += 1;
      } catch {
        totals.failed += 1;
      }
      setProgress(index + 1);
    }
    setResult(totals);
    setBusy(false);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent data-testid="memory-import-dialog">
        <DialogHeader>
          <DialogTitle>
            <Trans>Import notes</Trans>
          </DialogTitle>
        </DialogHeader>
        {result ? (
          <div className="space-y-2 text-sm">
            <p>{t`Imported: ${result.created}`}</p>
            {result.existing ? (
              <p className="text-muted-foreground">
                {t`Already there, left unchanged: ${result.existing}`}
              </p>
            ) : null}
            {result.skipped ? (
              <p className="text-muted-foreground">
                {t`Skipped (not Markdown, too large, conversation notes or unusable names): ${result.skipped}`}
              </p>
            ) : null}
            {result.failed ? (
              <p className="text-destructive" role="alert">
                {t`Could not import: ${result.failed}`}
              </p>
            ) : null}
            <DialogFooter>
              <Button onClick={onClose}>
                <Trans>Done</Trans>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run();
            }}
          >
            <p className="text-sm">
              {t`Notes to import: ${plan.items.length}`}
              {plan.skipped.length ? ` · ${t`Files to skip: ${plan.skipped.length}`}` : ""}
            </p>
            <label htmlFor={`${formId}-group`} className="block space-y-1 text-sm">
              <span>
                <Trans>Put notes without a group folder in</Trans>
              </span>
              <NativeSelect
                id={`${formId}-group`}
                value={destination}
                disabled={busy}
                onChange={(event) => setDestination(event.target.value)}
                className="w-full"
              >
                {groups.map((entry) => (
                  <NativeSelectOption key={entry.key} value={entry.key}>
                    {entry.key === "general" ? t`General (all non-isolated Micos)` : entry.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Folders named like General or a Mico, as an export writes them, go to that group.
                Existing notes are never replaced.
              </Trans>
            </p>
            {busy ? (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {t`Importing ${progress} of ${plan.items.length}…`}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Button type="submit" disabled={busy || plan.items.length === 0}>
                <Trans>Import</Trans>
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

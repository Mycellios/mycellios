import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import type { Artifact, Bot } from "@rakazo/contracts";
import { isAttachmentImageMimeType } from "@rakazo/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  BotAvatar,
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  parseBotAvatar,
  resolvePersonaColorDef,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
} from "@rakazo/ui-web";
import { skipToken, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  Download,
  Filter,
  LayoutGrid,
  List,
  Lock,
  Maximize2,
  Menu,
  Minimize2,
  Search,
  Trash2,
} from "lucide-react";
import { type ComponentProps, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { IconTooltip } from "../components/IconTooltip";
import { PdfViewer } from "../components/PdfViewer";
import { SandboxedHtmlViewer } from "../components/SandboxedHtmlViewer";
import { decodeArtifactBase64, downloadArtifactBytes } from "../lib/artifact-open";
import { takeInitialBootstrap } from "../lib/bootstrap";
import { desktopBridge, desktopDragClass } from "../lib/desktop";
import { useSpaceQueries, writeSaved } from "../lib/query";
import { formatRelativeTime } from "../lib/relative-time";
import { useSpaceRpc } from "../lib/space-rpc";
import { useObjectUrl } from "../lib/use-object-url";
import { errorText } from "../lib/user-error";
import { WindowChrome } from "./WindowChrome";

type ViewMode = "grid" | "list";
type DateFilter = "all" | "today" | "week" | "month";
type FileFilter = "all" | "images" | "documents" | "media" | "other";
const VIEW_MODE_STORAGE_KEY = "rakazo:artifacts-view-mode";
const LIST_PAGE_SIZE = 60;
const GRID_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

type ArtifactSummary = Artifact & { versionCount: number };

const NO_BOTS: Bot[] = [];

function readViewMode(): ViewMode {
  try {
    return window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function writeViewMode(mode: ViewMode): void {
  try {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // Preference only; ignore storage failures.
  }
}

function fileCategory(mimeType: string): Exclude<FileFilter, "all"> {
  if (isAttachmentImageMimeType(mimeType)) return "images";
  if (mimeType.startsWith("audio/") || mimeType.startsWith("video/")) return "media";
  if (mimeType.startsWith("text/") || /pdf|office|opendocument|msword|ms-excel|ms-powerpoint/.test(mimeType)) return "documents";
  return "other";
}

function libraryFileHref(params: URLSearchParams, artifactId?: string) {
  if (params.get("view") === "library") {
    const next = new URLSearchParams(params);
    if (artifactId) next.set("file", artifactId);
    else next.delete("file");
    return `?${next}`;
  }
  const path = artifactId ? `/app/artifacts/${encodeURIComponent(artifactId)}` : "/app/artifacts";
  return params.size ? `${path}?${params}` : path;
}

function LibraryFileLink({ artifactId, ...props }: Omit<ComponentProps<typeof Link>, "to"> & { artifactId: string }) {
  const [params] = useSearchParams();
  return <Link to={libraryFileHref(params, artifactId)} {...props} />;
}

function matchesCalendarDateFilter(iso: string, filter: DateFilter, now: Date): boolean {
  if (filter === "all") return true;
  const date = new Date(iso);
  if (filter === "today") return date.toDateString() === now.toDateString();
  if (filter === "week") {
    const startOfWeek = new Date(now);
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    return date >= startOfWeek;
  }
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

export function ArtifactsPage({ onOpenNavigation, workspaceBots }: {
  onOpenNavigation?: () => void;
  workspaceBots?: readonly Bot[];
} = {}) {
  const { artifactId: routeId } = useParams<{ artifactId?: string }>();
  const navigate = useNavigate();
  const { t } = useLingui();
  const [searchParams, setSearchParams] = useSearchParams();
  const embedded = Boolean(onOpenNavigation);
  const artifactId = routeId ?? (embedded ? searchParams.get("file") ?? undefined : undefined);
  const botParam = embedded ? "libraryBot" : "bot";
  const activeBotId = searchParams.get(botParam) || null;
  function setActiveBotId(id: string | null) {
    const next = new URLSearchParams(searchParams);
    if (id) next.set(botParam, id);
    else next.delete(botParam);
    setSearchParams(next, { replace: true });
  }
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [fileFilter, setFileFilter] = useState<FileFilter>("all");
  const [maximized, setMaximized] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ArtifactSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const queries = useSpaceQueries();
  const rpc = useSpaceRpc();
  const queryClient = useQueryClient();
  const standaloneBots = useQuery({
    queryKey: queries.bootstrap.queryKey({ input: {} }),
    queryFn: () => takeInitialBootstrap(),
    enabled: !workspaceBots,
    select: (bootstrap) => bootstrap.bots,
  }).data;
  const bots = workspaceBots ?? standaloneBots ?? NO_BOTS;
  const listingOptions = queries.artifacts.listSpace.infiniteOptions({
    input: (cursor: string | undefined) => ({
      botId: activeBotId ?? undefined,
      ...(cursor ? { cursor } : {}),
      limit: LIST_PAGE_SIZE,
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const listing = useInfiniteQuery(listingOptions);
  const items = useMemo(
    () => listing.data?.pages.flatMap((page) => page.items) ?? null,
    [listing.data],
  );
  const nextCursor = listing.data?.pages.at(-1)?.nextCursor ?? null;
  const loadingMore = listing.isFetchingNextPage;
  const loadError =
    listing.error && !listing.data ? errorText(listing.error, t`Could not load the library.`) : null;
  // A failed refresh over the cached list is still said; a failed next page keeps Load more.
  const refreshError =
    listing.data && listing.isRefetchError
      ? errorText(listing.error, t`Could not load the library.`)
      : null;

  function loadMore() {
    // A failed page keeps what is shown so Load more can be retried.
    if (nextCursor && !listing.isFetchingNextPage) void listing.fetchNextPage();
  }

  useEffect(() => {
    setMaximized(false);
  }, [artifactId]);

  const botsById = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);

  const filteredItems = useMemo(() => {
    if (!items) return null;
    const now = new Date();
    const query = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (!matchesCalendarDateFilter(item.createdAt, dateFilter, now)) return false;
      if (fileFilter !== "all" && fileCategory(item.mimeType) !== fileFilter) return false;
      if (!query) return true;
      return (
        item.name.toLowerCase().includes(query) ||
        (item.description?.toLowerCase().includes(query) ?? false)
      );
    });
  }, [items, searchQuery, dateFilter, fileFilter]);

  const clientFilterActive = searchQuery.trim().length > 0 || dateFilter !== "all" || fileFilter !== "all";
  const autoFetchedCursorRef = useRef<string | null>(null);

  useEffect(() => {
    autoFetchedCursorRef.current = null;
  }, [searchQuery, dateFilter, fileFilter, activeBotId]);

  function clearFilters() {
    setSearchQuery("");
    setDateFilter("all");
    setFileFilter("all");
    if (activeBotId) setActiveBotId(null);
  }

  // Search and date filters only see loaded pages, so keep paging until something matches.
  useEffect(() => {
    if (!clientFilterActive || !nextCursor || loadingMore || items === null) return;
    if (filteredItems && filteredItems.length > 0) return;
    if (autoFetchedCursorRef.current === nextCursor) return;
    autoFetchedCursorRef.current = nextCursor;
    void loadMore();
  }, [clientFilterActive, nextCursor, loadingMore, items, filteredItems]);

  function setMode(mode: ViewMode) {
    setViewMode(mode);
    writeViewMode(mode);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await rpc.artifacts.remove({ artifactId: pendingDelete.id });
      await writeSaved(queryClient, listingOptions.queryKey, (current) => ({
        pages: (current?.pages ?? []).map((page) => ({
          ...page,
          items: page.items.filter((item) => item.id !== pendingDelete.id),
        })),
        pageParams: current?.pageParams ?? [],
      }));
      // Listings for other bots may hold it too; they refresh when next shown.
      void queryClient.invalidateQueries({
        queryKey: queries.artifacts.listSpace.key(),
        refetchType: "none",
      });
      if (artifactId === pendingDelete.id) navigate(libraryFileHref(searchParams));
      setPendingDelete(null);
    } catch (error) {
      setDeleteError(errorText(error, t`Could not delete this file.`));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground" data-testid="file-library">
      <header className={`${desktopDragClass()} px-4 py-4 md:px-8 md:pt-7`}>
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
          <div className="flex min-w-0 items-center gap-2">
            {embedded ? (
              <Button type="button" variant="ghost" size="icon" aria-label={t`Open navigation`} onClick={onOpenNavigation} className="app-no-drag md:hidden">
                <Menu aria-hidden />
              </Button>
            ) : (
              <>
                {desktopBridge() ? <WindowChrome /> : null}
                <Link
                  to="/app"
                  className="app-no-drag flex shrink-0 items-center gap-0.5 rounded-lg py-1 pe-1.5 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <ChevronLeft size={16} strokeWidth={1.9} aria-hidden="true" />
                  <Trans>Micos</Trans>
                </Link>
              </>
            )}
            {artifactId ? (
              <Link to={libraryFileHref(searchParams)} className="app-no-drag inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
                <ChevronLeft size={16} aria-hidden />
                <Trans>Library</Trans>
              </Link>
            ) : <h1 className="text-heading2 font-semibold"><Trans>Library</Trans></h1>}
          </div>
          {!artifactId ? (
            <div className="app-no-drag flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full">
              <Button
                type="button"
                variant={filtersOpen || activeBotId || dateFilter !== "all" || fileFilter !== "all" ? "secondary" : "outline"}
                size="sm"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((open) => !open)}
              >
                <Filter strokeWidth={1.9} />
                <Trans>Filters</Trans>
              </Button>
              <ToggleGroup
                aria-label={t`Library view`}
                value={[viewMode]}
                onValueChange={([next]) => {
                  if (next) setMode(next as ViewMode);
                }}
                spacing={1}
                size="sm"
                className="rounded-lg border border-border p-0.5"
              >
                <IconTooltip label={t`Card view`}>
                  <ToggleGroupItem
                    value="grid"
                    aria-label={t`Card view`}
                    className="size-7 min-w-7 rounded-md px-0 text-muted-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                  >
                    <LayoutGrid size={15} strokeWidth={1.9} />
                  </ToggleGroupItem>
                </IconTooltip>
                <IconTooltip label={t`List view`}>
                  <ToggleGroupItem
                    value="list"
                    aria-label={t`List view`}
                    className="size-7 min-w-7 rounded-md px-0 text-muted-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                  >
                    <List size={15} strokeWidth={1.9} />
                  </ToggleGroupItem>
                </IconTooltip>
              </ToggleGroup>
              <div className="relative min-w-36 flex-1 sm:w-64">
                <Search
                  size={14}
                  strokeWidth={1.9}
                  className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  type="search"
                  aria-label={t`Search the library`}
                  placeholder={t`Search the library`}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="ps-8"
                />
              </div>
            </div>
          ) : null}
        </div>

        {filtersOpen && !artifactId ? (
          <div className="app-no-drag mt-3 flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label={t`File type`}
              className="w-auto text-[13px]"
              value={fileFilter}
              onChange={(event) => setFileFilter(event.target.value as FileFilter)}
            >
              <NativeSelectOption value="all">{t`All file types`}</NativeSelectOption>
              <NativeSelectOption value="images">{t`Images`}</NativeSelectOption>
              <NativeSelectOption value="documents">{t`Documents`}</NativeSelectOption>
              <NativeSelectOption value="media">{t`Audio and video`}</NativeSelectOption>
              <NativeSelectOption value="other">{t`Other files`}</NativeSelectOption>
            </NativeSelect>
            <NativeSelect
              aria-label={t`Filter by date`}
              className="w-auto text-[13px]"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value as DateFilter)}
            >
              <NativeSelectOption value="all">{t`All time`}</NativeSelectOption>
              <NativeSelectOption value="today">{t`Today`}</NativeSelectOption>
              <NativeSelectOption value="week">{t`This week`}</NativeSelectOption>
              <NativeSelectOption value="month">{t`This month`}</NativeSelectOption>
            </NativeSelect>
            <FilterChip active={activeBotId === null} onClick={() => setActiveBotId(null)}>
              <Trans>All bots</Trans>
            </FilterChip>
            {bots.map((bot) => (
              <BotFilterChip
                key={bot.id}
                bot={bot}
                active={activeBotId === bot.id}
                onClick={() => setActiveBotId(bot.id)}
              />
            ))}
          </div>
        ) : null}
      </header>

      {refreshError ? (
        <p role="alert" className="px-6 py-2 text-sm text-destructive">
          {refreshError}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {artifactId ? (
          <>
            {!maximized ? (
              <IndexPane
                items={filteredItems}
                loadError={loadError}
                botsById={botsById}
                selectedId={artifactId}
                onRequestDelete={setPendingDelete}
                nextCursor={nextCursor}
                loadingMore={loadingMore}
                onLoadMore={loadMore}
              />
            ) : null}
            <PreviewPane
              key={artifactId}
              artifactId={artifactId}
              maximized={maximized}
              onToggleMaximize={() => setMaximized((value) => !value)}
            />
          </>
        ) : (
          <BrowsingPane
            items={filteredItems}
            loadError={loadError}
            viewMode={viewMode}
            filtered={clientFilterActive || Boolean(activeBotId)}
            onClearFilters={clearFilters}
            botsById={botsById}
            onRequestDelete={setPendingDelete}
            nextCursor={nextCursor}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
          />
        )}
      </div>

      {pendingDelete ? (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open && !deleteBusy) setPendingDelete(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                <Trans>Delete "{pendingDelete.name}"?</Trans>
              </AlertDialogTitle>
              <AlertDialogDescription>
                {pendingDelete.versionCount > 1 ? (
                  <Trans>
                    This deletes all {pendingDelete.versionCount} versions of this file. This
                    can't be undone.
                  </Trans>
                ) : (
                  <Trans>This can't be undone.</Trans>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {deleteError ? <p className="text-[13.5px] text-destructive">{deleteError}</p> : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteBusy}>
                <Trans>Cancel</Trans>
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={deleteBusy}
                onClick={() => void confirmDelete()}
              >
                {deleteBusy ? <Trans>Deleting…</Trans> : <Trans>Delete</Trans>}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}

function BrowsingPane({
  items,
  loadError,
  viewMode,
  filtered,
  onClearFilters,
  botsById,
  onRequestDelete,
  nextCursor,
  loadingMore,
  onLoadMore,
}: {
  items: ArtifactSummary[] | null;
  loadError: string | null;
  viewMode: ViewMode;
  filtered: boolean;
  onClearFilters: () => void;
  botsById: Map<string, Bot>;
  onRequestDelete: (artifact: ArtifactSummary) => void;
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  if (items === null) {
    return (
      <div className="grid flex-1 place-items-center text-sm text-muted-foreground/80">
        {loadError ?? <Spinner aria-label={t`Loading…`} />}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyArtifacts
        className="flex flex-1 flex-col items-center px-6 pt-7 text-center text-sm text-muted-foreground"
        filtered={filtered}
        onClearFilters={onClearFilters}
        nextCursor={nextCursor}
        loadingMore={loadingMore}
        onLoadMore={onLoadMore}
      />
    );
  }
  return (
    <div className="rk-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-5 md:px-8">
      {viewMode === "grid" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-3">
          {items.map((item) => (
            <ArtifactCard
              key={item.id}
              artifact={item}
              bot={item.botId ? botsById.get(item.botId) : undefined}
              onRequestDelete={onRequestDelete}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
          {items.map((item) => (
            <ArtifactRow
              key={item.id}
              artifact={item}
              bot={item.botId ? botsById.get(item.botId) : undefined}
              onRequestDelete={onRequestDelete}
            />
          ))}
        </div>
      )}
      {nextCursor ? <LoadMoreButton loading={loadingMore} onClick={onLoadMore} /> : null}
    </div>
  );
}

function LoadMoreButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <div className="mt-4 flex justify-center">
      <Button
        variant="outline"
        size="sm"
        disabled={loading}
        onClick={onClick}
        aria-label={t`Load more`}
      >
        {loading ? <Spinner aria-label={t`Loading…`} /> : null}
        <Trans>Load more</Trans>
      </Button>
    </div>
  );
}

function EmptyArtifacts({
  className,
  filtered = false,
  onClearFilters,
  nextCursor,
  loadingMore,
  onLoadMore,
}: {
  className: string;
  filtered?: boolean;
  onClearFilters?: () => void;
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  if (!nextCursor) {
    return (
      <div className={className}>
        {filtered ? (
          <>
            <p className="font-medium text-foreground"><Trans>No files match your search.</Trans></p>
            {onClearFilters ? (
              <Button type="button" variant="text" className="mt-2" onClick={onClearFilters}>
                <Trans>Clear filters</Trans>
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <p className="font-medium text-foreground"><Trans>No files yet</Trans></p>
            <p className="mt-2 max-w-[21rem]"><Trans>Files you attach in chat and files your Micos share appear here.</Trans></p>
          </>
        )}
      </div>
    );
  }
  return (
    <div className={className}>
      <div className="flex flex-col items-center gap-3">
        <span>
          {loadingMore ? (
            <Spinner aria-label={t`Loading…`} />
          ) : (
            <Trans>No matching files on this page.</Trans>
          )}
        </span>
        <LoadMoreButton loading={loadingMore} onClick={onLoadMore} />
      </div>
    </div>
  );
}

function IndexPane({
  items,
  loadError,
  botsById,
  selectedId,
  onRequestDelete,
  nextCursor,
  loadingMore,
  onLoadMore,
}: {
  items: ArtifactSummary[] | null;
  loadError: string | null;
  botsById: Map<string, Bot>;
  selectedId: string;
  onRequestDelete: (artifact: ArtifactSummary) => void;
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <aside className="hidden w-[320px] shrink-0 flex-col overflow-y-auto border-e border-border lg:flex">
      {items === null ? (
        <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground/80">
          {loadError ?? <Spinner aria-label={t`Loading…`} />}
        </div>
      ) : items.length === 0 ? (
        <EmptyArtifacts
          className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground/80"
          nextCursor={nextCursor}
          loadingMore={loadingMore}
          onLoadMore={onLoadMore}
        />
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {items.map((item) => (
            <ArtifactRow
              key={item.id}
              artifact={item}
              bot={item.botId ? botsById.get(item.botId) : undefined}
              active={item.id === selectedId}
              onRequestDelete={onRequestDelete}
            />
          ))}
          {nextCursor ? (
            <div className="p-3">
              <LoadMoreButton loading={loadingMore} onClick={onLoadMore} />
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function useBotColorHex(bot: Bot): string {
  return useMemo(() => {
    const parsed = parseBotAvatar(bot.color, bot.id);
    const effectiveId = bot.id || parsed.color || "agent";
    return resolvePersonaColorDef(effectiveId, parsed.color).hex;
  }, [bot.color, bot.id]);
}

function BotFilterChip({
  bot,
  active,
  onClick,
}: {
  bot: Bot;
  active: boolean;
  onClick: () => void;
}) {
  const hex = useBotColorHex(bot);
  return (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={active}
      onClick={onClick}
      style={{ backgroundColor: active ? `${hex}26` : undefined, borderColor: `${hex}66` }}
      className={active ? "text-foreground" : "text-muted-foreground"}
    >
      <BotAvatar color={bot.color} identity={bot.id} size={16} status={bot.status} />
      <span className="max-w-[120px] truncate">{bot.name}</span>
    </Button>
  );
}

function ArtifactCard({
  artifact,
  bot,
  onRequestDelete,
}: {
  artifact: ArtifactSummary;
  bot: Bot | undefined;
  onRequestDelete: (artifact: ArtifactSummary) => void;
}) {
  const { t } = useLingui();
  return (
    <div className="group relative">
      <LibraryFileLink
        artifactId={artifact.id}
        className="flex flex-col gap-3 rounded-xl border border-border p-3 text-foreground hover:bg-accent/40"
      >
        <div className="flex items-start justify-between">
          <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-accent text-accent-foreground">
            <ArtifactMimeIcon mimeType={artifact.mimeType} />
          </span>
          <div className="flex items-center gap-1.5">
            {artifact.versionCount > 1 ? (
              <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                {`v${artifact.version}`}
              </span>
            ) : null}
            <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground">
              {mimeLabel(artifact.mimeType)}
            </span>
          </div>
        </div>
        {isAttachmentImageMimeType(artifact.mimeType) && artifact.size <= GRID_IMAGE_MAX_BYTES ? (
          <ArtifactThumbnail key={artifact.version} artifact={artifact} />
        ) : null}
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">{artifact.name}</div>
          {artifact.description ? (
            <div className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
              {artifact.description}
            </div>
          ) : null}
        </div>
        <div className="mt-auto flex min-h-6 items-center gap-2 pe-8 text-[12px] text-muted-foreground">
          {bot ? (
            <>
              <BotAvatar color={bot.color} identity={bot.id} size={20} status={bot.status} />
              <span className="min-w-0 flex-1 truncate">{bot.name}</span>
            </>
          ) : (
            <span className="flex-1" />
          )}
          <span className="shrink-0">{formatRelativeTime(artifact.createdAt)}</span>
        </div>
      </LibraryFileLink>
      <IconTooltip label={t`Delete ${artifact.name}`}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`Delete ${artifact.name}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRequestDelete(artifact);
          }}
          className="absolute bottom-3 end-3 bg-card text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <Trash2 strokeWidth={1.9} />
        </Button>
      </IconTooltip>
    </div>
  );
}

function ArtifactThumbnail({ artifact }: { artifact: ArtifactSummary }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const queries = useSpaceQueries();
  const versions = useQuery(queries.artifacts.listVersions.queryOptions({
    input: visible && artifact.versionCount > 1 ? { familyId: artifact.id } : skipToken,
  })).data;
  const versionId = artifact.versionCount > 1 ? versions?.[0]?.id : artifact.id;
  const image = useQuery(queries.artifacts.getById.queryOptions({
    input: visible && versionId ? { artifactId: versionId } : skipToken,
  })).data;
  const bytes = useMemo(
    () => image && image.size <= GRID_IMAGE_MAX_BYTES && isAttachmentImageMimeType(image.mimeType)
      ? decodeArtifactBase64(image.contentBase64)
      : null,
    [image],
  );

  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="grid aspect-video place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
      {bytes && image ? (
        <ArtifactThumbnailImage bytes={bytes} mimeType={image.mimeType} />
      ) : <ArtifactMimeIcon mimeType={artifact.mimeType} />}
    </div>
  );
}

function ArtifactThumbnailImage({ bytes, mimeType }: { bytes: Uint8Array; mimeType: string }) {
  const url = useObjectUrl(bytes, mimeType);
  return url ? <img src={url} alt="" className="size-full min-h-0 object-contain" /> : null;
}

function ArtifactRow({
  artifact,
  bot,
  active,
  onRequestDelete,
}: {
  artifact: ArtifactSummary;
  bot: Bot | undefined;
  active?: boolean;
  onRequestDelete: (artifact: ArtifactSummary) => void;
}) {
  const { t } = useLingui();
  return (
    <div className={`group relative ${active ? "bg-accent/60" : "hover:bg-accent/40"}`}>
      <LibraryFileLink artifactId={artifact.id} className="flex flex-col gap-1 px-4 py-3 pe-10" aria-current={active ? "page" : undefined}>
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-accent text-accent-foreground">
            <ArtifactMimeIcon mimeType={artifact.mimeType} small />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{artifact.name}</span>
          {artifact.versionCount > 1 ? (
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
              {`v${artifact.version}`}
            </span>
          ) : null}
        </div>
        {artifact.description ? (
          <div className="ps-8 text-[12.5px] leading-snug text-muted-foreground">
            {artifact.description}
          </div>
        ) : null}
        <div className="flex items-center gap-1.5 ps-8 text-[11.5px] text-muted-foreground">
          {bot ? (
            <>
              <BotAvatar color={bot.color} identity={bot.id} size={14} status={bot.status} />
              <span className="me-1 max-w-[140px] truncate">{bot.name}</span>
            </>
          ) : null}
          <span>{formatRelativeTime(artifact.createdAt)}</span>
        </div>
      </LibraryFileLink>
      <IconTooltip label={t`Delete ${artifact.name}`}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`Delete ${artifact.name}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRequestDelete(artifact);
          }}
          className="absolute inset-y-0 end-2 my-auto text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <Trash2 strokeWidth={1.9} />
        </Button>
      </IconTooltip>
    </div>
  );
}

function ArtifactMimeIcon({ mimeType, small }: { mimeType: string; small?: boolean }) {
  const size = small ? 12 : 16;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {mimeType === "text/html" ? (
        <>
          <polyline points="8 6 2 12 8 18" />
          <polyline points="16 6 22 12 16 18" />
        </>
      ) : (
        <>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </>
      )}
    </svg>
  );
}

function mimeLabel(mimeType: string): string {
  if (mimeType === "text/html") return "HTML";
  if (mimeType === "text/markdown") return "MD";
  if (mimeType === "application/pdf") return "PDF";
  const slash = mimeType.indexOf("/");
  return (slash === -1 ? mimeType : mimeType.slice(slash + 1)).toUpperCase().slice(0, 6);
}

function PreviewPane({
  artifactId,
  maximized,
  onToggleMaximize,
}: {
  artifactId: string;
  maximized: boolean;
  onToggleMaximize: () => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const versionsQuery = useQuery(
    queries.artifacts.listVersions.queryOptions({
      input: { familyId: artifactId },
    }),
  );
  const versions = versionsQuery.data ?? null;
  const [pickedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const selectedVersionId =
    pickedVersionId ??
    (versions ? (versions[0]?.id ?? artifactId) : versionsQuery.isError ? artifactId : null);
  const artifactQuery = useQuery(
    queries.artifacts.getById.queryOptions({
      input: selectedVersionId ? { artifactId: selectedVersionId } : skipToken,
    }),
  );
  const bytes = useMemo(
    () => (artifactQuery.data ? decodeArtifactBase64(artifactQuery.data.contentBase64) : null),
    [artifactQuery.data],
  );
  const state:
    | { status: "loading" }
    | { status: "ready"; artifact: Artifact; bytes: Uint8Array }
    | { status: "error"; message: string } =
    artifactQuery.data && bytes
      ? { status: "ready", artifact: artifactQuery.data, bytes }
      : artifactQuery.error
        ? {
            status: "error",
            message: errorText(artifactQuery.error, t`Could not load this file.`),
          }
        : { status: "loading" };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-semibold">
            {state.status === "ready" ? state.artifact.name : null}
          </h2>
          {state.status === "ready" && state.artifact.description ? (
            <p className="truncate text-[12.5px] text-muted-foreground">
              {state.artifact.description}
            </p>
          ) : null}
        </div>
        {versions && versions.length > 1 && selectedVersionId ? (
          <NativeSelect
            aria-label={t`Version`}
            className="w-auto shrink-0 text-[13px]"
            value={selectedVersionId}
            onChange={(event) => setSelectedVersionId(event.target.value)}
          >
            {versions.map((entry) => (
              <NativeSelectOption key={entry.id} value={entry.id}>
                {`v${entry.version} (${formatRelativeTime(entry.createdAt)})`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : null}
        {state.status === "ready" ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadArtifactBytes(state.artifact.name, state.artifact.mimeType, state.bytes)
              }
            >
              <Download className="me-1.5" size={15} strokeWidth={1.9} />
              <Trans>Download</Trans>
            </Button>
            <IconTooltip label={maximized ? t`Show list` : t`Maximize`}>
              <Button
                variant="outline"
                size="icon"
                aria-label={maximized ? t`Show list` : t`Maximize`}
                onClick={onToggleMaximize}
                className="text-muted-foreground"
              >
                {maximized ? (
                  <Minimize2 size={15} strokeWidth={1.9} />
                ) : (
                  <Maximize2 size={15} strokeWidth={1.9} />
                )}
              </Button>
            </IconTooltip>
          </>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 p-5">
        {state.status === "loading" ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground/80">
            <Spinner aria-label={t`Loading…`} />
          </div>
        ) : state.status === "error" ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive">
            {state.message}
          </div>
        ) : (
          <div className="relative h-full overflow-hidden rounded-2xl border border-border">
            <ArtifactPreview artifact={state.artifact} bytes={state.bytes} />
            {state.artifact.mimeType === "text/html" ? (
              <div className="absolute bottom-3 end-3 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1.5 text-[11px] text-white">
                <Lock size={12} strokeWidth={2} />
                <span>
                  <Trans>Isolated preview — no access to your account</Trans>
                </span>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function ArtifactPreview({ artifact, bytes }: { artifact: Artifact; bytes: Uint8Array }) {
  if (artifact.mimeType === "text/html") {
    const html = new TextDecoder("utf-8").decode(bytes);
    return <SandboxedHtmlViewer html={html} title={artifact.name} />;
  }
  if (artifact.mimeType === "text/markdown") {
    const text = new TextDecoder("utf-8").decode(bytes);
    return (
      <div className="h-full overflow-y-auto bg-background">
        <article className="mx-auto w-full max-w-[760px] px-8 py-10 text-[16px] leading-7 text-foreground">
          <ChatMarkdown>{text}</ChatMarkdown>
        </article>
      </div>
    );
  }
  if (artifact.mimeType === "application/pdf") {
    return <PdfViewer bytes={bytes} title={artifact.name} />;
  }
  if (isAttachmentImageMimeType(artifact.mimeType)) {
    return <ImagePreview bytes={bytes} mimeType={artifact.mimeType} name={artifact.name} />;
  }
  return (
    <div className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground/80">
      <Trans>Preview isn't available for this file type — download it to view it.</Trans>
    </div>
  );
}

function ImagePreview({
  bytes,
  mimeType,
  name,
}: {
  bytes: Uint8Array;
  mimeType: string;
  name: string;
}) {
  const url = useObjectUrl(bytes, mimeType);
  if (!url) return null;
  return (
    <div className="grid h-full place-items-center overflow-auto bg-muted/40 p-4">
      <img src={url} alt={name} className="max-h-full max-w-full rounded-lg shadow-sm" />
    </div>
  );
}

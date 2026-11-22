import { Trans, useLingui } from "@lingui/react/macro";
import type { SearchFilter, SearchHit } from "@mycellios/contracts";
import { searchHitListKey } from "@mycellios/core";

function SearchFilters({
  filter,
  onFilter,
}: {
  filter: SearchFilter;
  onFilter: (filter: SearchFilter) => void;
}) {
  const { t } = useLingui();
  const filters: Array<[SearchFilter, string]> = [
    ["all", t`All`],
    ["messages", t`Messages`],
    ["micos", t`Micos`],
    ["groups", t`Groups`],
    ["files", t`Files`],
    ["routines", t`Routines`],
  ];
  return (
    <fieldset
      aria-label={t`Show results`}
      data-testid="search-filters"
      className="m-0 flex min-w-0 flex-wrap gap-1 border-0 px-1 pb-1.5 pt-0"
    >
      {filters.map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={filter === value}
          onClick={() => onFilter(value)}
          className={`rounded-full px-2.5 py-1 text-[12px] ${
            filter === value
              ? "bg-foreground text-background"
              : "bg-sidebar-accent/60 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </fieldset>
  );
}

export function SpaceSearchResults({
  hits,
  loading,
  onSelect,
  filter = "all",
  onFilter,
}: {
  hits: SearchHit[];
  loading: boolean;
  onSelect: (hit: SearchHit) => void;
  filter?: SearchFilter;
  onFilter?: (filter: SearchFilter) => void;
}) {
  const { t } = useLingui();
  const filters = onFilter ? <SearchFilters filter={filter} onFilter={onFilter} /> : null;
  if (loading) {
    return (
      <>
        {filters}
        <div className="px-3 py-4 text-[14px] text-muted-foreground">
          <Trans>Searching…</Trans>
        </div>
      </>
    );
  }
  if (!hits.length) {
    return (
      <>
        {filters}
        <div className="px-3 py-4 text-[14px] text-muted-foreground">
          <Trans>No results</Trans>
        </div>
      </>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      {filters}
      {hits.map((hit) => (
        <button
          key={searchHitListKey(hit)}
          type="button"
          onClick={() => onSelect(hit)}
          className="rounded-xl px-2.5 py-[11px] text-start hover:bg-sidebar-accent"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[15px] font-medium text-foreground" dir="auto">
              {hit.title}
            </span>
            <span className="shrink-0 text-[12px] uppercase tracking-wide text-muted-foreground/80">
              {hit.kind}
            </span>
          </div>
          <div className="mt-0.5 flex min-w-0 gap-2 text-[13px] text-muted-foreground" dir="auto">
            <span className="max-w-[40%] shrink-0 truncate text-foreground/75">
              {hit.groupName ?? hit.botName}
              {hit.taskThreadId ? (
                <span data-testid="search-hit-conversation">
                  {" · "}
                  {hit.conversationTitle || t`Untitled conversation`}
                </span>
              ) : null}
            </span>
            <span className="truncate">{hit.snippet}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

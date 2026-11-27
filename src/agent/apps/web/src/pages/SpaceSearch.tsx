import { Trans, useLingui } from "@lingui/react/macro";
import type { SearchFilter, SearchHit } from "@mycellios/contracts";
import { searchHitListKey } from "@mycellios/core";
import { BotAvatar, DEFAULT_BOT_AVATAR_COLOR } from "@mycellios/ui-web";
import { CalendarClock, FileText, Link2, Users } from "lucide-react";
import type { ReactNode } from "react";

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

type SectionKey = "micos" | "groups" | "messages" | "files" | "links" | "routines";
const SECTION_ORDER: SectionKey[] = ["micos", "groups", "messages", "files", "links", "routines"];

/** Results read as sections of one kind each, so no row needs its own kind label. */
export function searchHitSection(hit: SearchHit): SectionKey {
  if (hit.kind === "conversation") return hit.groupId ? "groups" : "micos";
  if (hit.kind === "message") return "messages";
  if (hit.kind === "file") return "files";
  if (hit.kind === "link") return "links";
  return "routines";
}

function ownerName(hit: SearchHit): string {
  return hit.groupName ?? hit.botName ?? "";
}

/** The grey text after the title: what the result is about, never a repeat of its title. */
function searchHitDetail(hit: SearchHit): string {
  if (hit.kind === "file") return ownerName(hit);
  const detail = hit.snippet.trim();
  return detail === hit.title.trim() ? "" : detail;
}

/** Marks the first place the query appears, ignoring case. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLocaleLowerCase();
  const at = needle ? text.toLocaleLowerCase().indexOf(needle) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-transparent font-medium text-foreground">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

function ResultIcon({ hit, colorFor }: { hit: SearchHit; colorFor?: (botId: string) => string | undefined }) {
  const iconClass = "flex size-5 shrink-0 items-center justify-center text-muted-foreground";
  if (hit.kind === "file") return <span className={iconClass} aria-hidden><FileText size={15} /></span>;
  if (hit.kind === "link") return <span className={iconClass} aria-hidden><Link2 size={15} /></span>;
  if (hit.kind === "routine") return <span className={iconClass} aria-hidden><CalendarClock size={15} /></span>;
  if (hit.groupId || !hit.botId) return <span className={iconClass} aria-hidden><Users size={15} /></span>;
  return (
    <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
      <BotAvatar color={colorFor?.(hit.botId) ?? DEFAULT_BOT_AVATAR_COLOR} identity={hit.botId} size={20} />
    </span>
  );
}

export function SpaceSearchResults({
  hits,
  loading,
  onSelect,
  filter = "all",
  onFilter,
  query = "",
  botColor,
}: {
  hits: SearchHit[];
  loading: boolean;
  onSelect: (hit: SearchHit) => void;
  filter?: SearchFilter;
  onFilter?: (filter: SearchFilter) => void;
  /** The typed text, marked in each result. */
  query?: string;
  /** A Mico's avatar color, so its results show the same face as the sidebar. */
  botColor?: (botId: string) => string | undefined;
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
  const sectionLabel: Record<SectionKey, string> = {
    micos: t`Micos`,
    groups: t`Groups`,
    messages: t`Messages`,
    files: t`Files`,
    links: t`Links`,
    routines: t`Routines`,
  };
  const sections = SECTION_ORDER.map((key) => ({
    key,
    hits: hits.filter((hit) => searchHitSection(hit) === key),
  })).filter((section) => section.hits.length);
  return (
    <div className="flex flex-col">
      {filters}
      {sections.map((section, index) => (
        <section key={section.key} aria-label={sectionLabel[section.key]} data-testid={`search-section-${section.key}`}>
          <h3
            className={`flex items-baseline justify-between px-2.5 pb-1 text-[12px] font-medium text-muted-foreground ${index ? "pt-3" : "pt-1"}`}
          >
            <span>{sectionLabel[section.key]}</span>
            <span className="tabular-nums">{section.hits.length}</span>
          </h3>
          {section.hits.map((hit) => (
            <SearchRow key={searchHitListKey(hit)} hit={hit} query={query} botColor={botColor} onSelect={onSelect}
              conversationLabel={hit.taskThreadId ? hit.conversationTitle || t`Untitled conversation` : undefined} />
          ))}
        </section>
      ))}
    </div>
  );
}

function SearchRow({
  hit,
  query,
  botColor,
  onSelect,
  conversationLabel,
}: {
  hit: SearchHit;
  query: string;
  botColor?: (botId: string) => string | undefined;
  onSelect: (hit: SearchHit) => void;
  conversationLabel?: string;
}) {
  // A message reads "who: what was said"; everything else "name: what it is".
  const title: ReactNode =
    hit.kind === "message" ? (
      <>
        {ownerName(hit) || hit.title}
        {conversationLabel ? <span data-testid="search-hit-conversation">{` · ${conversationLabel}`}</span> : null}
      </>
    ) : (
      <Highlighted text={hit.title} query={query} />
    );
  const detail = searchHitDetail(hit);
  return (
    <button
      type="button"
      onClick={() => onSelect(hit)}
      className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[14px] hover:bg-sidebar-accent"
    >
      <ResultIcon hit={hit} colorFor={botColor} />
      <span className="max-w-[45%] shrink-0 truncate font-medium text-foreground" dir="auto">
        {title}
      </span>
      {detail ? (
        <span className="min-w-0 flex-1 truncate text-muted-foreground" dir="auto">
          <Highlighted text={detail} query={query} />
        </span>
      ) : null}
    </button>
  );
}

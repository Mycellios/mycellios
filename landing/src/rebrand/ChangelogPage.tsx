import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUpRight, Download, Hash } from "lucide-react";
import { Button, Card, Heading, Link, Text } from "../ui/primitives";
import { MarketingFooter, MarketingHeader } from "./MarketingHeader";
import { CHANGELOG_FILTERS, CHANGELOG_RELEASES, releaseFilterFor, releasesFor, type ChangelogRelease, type ReleaseFilter } from "../../../src/contracts/marketing-changelog";
import "./changelog-page.css";

const formatDate = (date: string, monthOnly = false) => new Intl.DateTimeFormat("en", monthOnly ? { month: "long", year: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const formatDay = (date: string) => new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

function ReleaseNote({ release, latest }: { release: ChangelogRelease; latest: boolean }) {
  return <Card className="changelog-release" id={release.id} aria-labelledby={`${release.id}-title`} data-release>
    <header><div className="changelog-release-meta"><time dateTime={release.date}>{formatDate(release.date)}</time>{latest && <span className="changelog-latest">Latest update</span>}<span>{release.platform}</span><span>{release.channel}</span></div>
      <Heading as="h2" id={`${release.id}-title`}><Link href={`#${release.id}`} aria-label={release.product === "desktop" ? `Desktop ${release.version} · ${release.platform}` : "Mycellios Agent web update"}>{release.product === "desktop" ? `Desktop ${release.version}` : "Mycellios Agent"}<Hash size={20} aria-hidden="true" /></Link></Heading>
      <Heading as="h3" className="changelog-release-title">{release.title}</Heading><Text>{release.summary}</Text>
    </header>
    {release.groups.map(group => <section className="changelog-change-group" key={group.kind} aria-label={`${group.kind} in ${release.platform} ${release.version}`}><Heading as="h4" data-change-kind={group.kind}>{group.kind}<span>{group.items.length}</span></Heading><ul>{group.items.map(item => <li key={item}>{item}</li>)}</ul></section>)}
    <div className="changelog-update-note"><strong>About this update</strong><Text>{release.updateNote}</Text></div>
    <Link className="changelog-source" href={release.sourceUrl} target="_blank" rel="noreferrer">{release.product === "desktop" ? "Original release notes" : "Publication details"}<ArrowUpRight size={15} aria-hidden="true" /></Link>
  </Card>;
}

export function ChangelogPage() {
  const [filter, setFilter] = useState<ReleaseFilter>(() => releaseFilterFor(typeof window === "undefined" ? "" : window.location.search));
  const entries = releasesFor(filter), latest = CHANGELOG_RELEASES[0]!;
  const [active, setActive] = useState(entries[0]!.id);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === "undefined") return;
    const articles = [...root.current.querySelectorAll<HTMLElement>("[data-release]")];
    const observer = new IntersectionObserver(() => {
      const visible = articles.map(article => ({ id: article.id, rect: article.getBoundingClientRect() }))
        .filter(article => article.rect.bottom > innerHeight * .2 && article.rect.top < innerHeight * .75)
        .sort((a, b) => Math.abs(a.rect.top - innerHeight * .2) - Math.abs(b.rect.top - innerHeight * .2));
      if (visible[0]) setActive(visible[0].id);
    }, { threshold: [0, .15, .4, .7, 1] });
    articles.forEach(article => observer.observe(article));
    return () => observer.disconnect();
  }, [filter]);

  function chooseFilter(next: ReleaseFilter) {
    const url = new URL(window.location.href);
    if (next === "all") url.searchParams.delete("product"); else url.searchParams.set("product", next);
    url.hash = "";
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    setFilter(next); setActive(releasesFor(next)[0]!.id);
  }
  const months = [...new Set(entries.map(entry => entry.date.slice(0, 7)))];

  return <div className="marketing-page changelog-page"><MarketingHeader active="changelog" /><main className="marketing-shell">
    <section className="changelog-hero" aria-labelledby="changelog-title">
      <div className="changelog-hero-copy"><Heading as="h1" id="changelog-title">What’s new<br />in Mycellios.</Heading><Text>The latest releases, useful improvements and small fixes that make room for better work.</Text><Link href="#release-history" className="changelog-jump">Explore the updates<ArrowDown size={16} aria-hidden="true" /></Link></div>
      <img className="changelog-hero-art" src="/assets/landing/network-fruiting.webp" width="1774" height="877" alt="Computers connected by mycelium, with mushrooms growing across the network." fetchPriority="high" />
      <div className="changelog-latest-strip"><Text><span className="changelog-status-dot" aria-hidden="true" />Latest Desktop preview<Link href={`#${latest.id}`} onClick={() => chooseFilter("all")}>{latest.version} · {latest.platform}</Link><time dateTime={latest.date}>{formatDate(latest.date)}</time></Text><Link href="/downloads/desktop" variant="primary" size="sm"><Download size={14} aria-hidden="true" />Download for desktop</Link></div>
    </section>
    <div className="changelog-layout" id="release-history" ref={root}>
      <aside className="changelog-index">
        <div className="changelog-filters" role="group" aria-label="Filter product updates">{CHANGELOG_FILTERS.map(item => <Button key={item.id} className="marketing-toggle" variant="ghost" aria-label={item.label} aria-pressed={filter === item.id} onClick={() => chooseFilter(item.id)}>{item.id === "all" ? "All" : item.label}</Button>)}</div>
        <nav aria-label="Release archive">
          <div className="changelog-index-heading"><strong>Release archive</strong><span aria-live="polite">{entries.length} {entries.length === 1 ? "update" : "updates"}</span></div>
          {months.map(month => <div className="changelog-month" key={month}><Text>{formatDate(`${month}-01`, true)}</Text><ul>{entries.filter(entry => entry.date.startsWith(month)).map(entry => <li key={entry.id}><Link href={`#${entry.id}`} aria-current={active === entry.id ? "location" : undefined} onClick={() => setActive(entry.id)}><span><strong>{entry.version}</strong><small>{entry.platform}</small></span><time dateTime={entry.date}>{formatDay(entry.date)}</time></Link></li>)}</ul></div>)}
        </nav>
        <Link className="changelog-index-journal" href="/blog">Stories behind the work<ArrowUpRight size={14} aria-hidden="true" /></Link>
      </aside>
      <div className="changelog-notes">
        {entries.map(entry => <ReleaseNote key={entry.id} release={entry} latest={entry.id === latest.id} />)}
        {filter !== "desktop" && <section className="changelog-coming" aria-labelledby="changelog-coming-title"><Heading as="h2" id="changelog-coming-title">Coming soon.</Heading><Text>A refreshed product tour and new Journal guides are being prepared. They will join this record when published.</Text><Link href="/blog">Explore Journal<ArrowUpRight size={15} aria-hidden="true" /></Link></section>}
      </div>
    </div></main><MarketingFooter /></div>;
}

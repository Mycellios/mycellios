import { useEffect, useState } from "react";
import { ArrowUpRight, BookOpen } from "lucide-react";
import { Card, Heading, Link, Text } from "../ui/primitives";
import { parseMarketingJournal, type MarketingJournal } from "../../../src/contracts/marketing-journal";
import "./marketing-journal.css";

export default function MarketingJournal() {
  const [journal, setJournal] = useState<MarketingJournal | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const abort = new AbortController(), timer = window.setTimeout(() => { setUnavailable(true); abort.abort(); }, 6_000);
    void fetch("/public/v1/journal", { signal: abort.signal, credentials: "omit", headers: { Accept: "application/json" } })
      .then(async response => { if (!response.ok) throw new Error("Journal unavailable"); return parseMarketingJournal(await response.json()); })
      .then(data => { if (!abort.signal.aborted) setJournal(data); })
      .catch(() => { if (!abort.signal.aborted) setUnavailable(true); })
      .finally(() => window.clearTimeout(timer));
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, []);
  return <section className="marketing-journal reference-shell" aria-labelledby="marketing-journal-title"><div className="marketing-journal-heading"><div><Heading as="h2" id="marketing-journal-title">Notes from<br />the network.</Heading><Text>Practical guides, project ideas and field notes from Mycellios.</Text></div><Link href="/blog">Explore the journal<ArrowUpRight size={16} /></Link></div>{journal?.items.length ? <div className="marketing-journal-entries">{journal.items.map(entry => <Card key={entry.path}>{entry.image && <Link href={entry.path} tabIndex={-1} aria-hidden="true"><img src={entry.image.url} alt={entry.image.alt} loading="lazy" /></Link>}<div className="marketing-journal-meta"><span>{entry.category}</span><time dateTime={entry.publishedAt}>{new Date(entry.publishedAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}</time></div><Heading as="h3"><Link href={entry.path}>{entry.title}</Link></Heading><Text>{entry.excerpt}</Text><Link href={entry.path}>Read article<ArrowUpRight size={14} /></Link></Card>)}</div> : <div className="marketing-journal-growing"><BookOpen size={31} aria-hidden="true" /><div><Heading as="h3">Good questions grow into guides.</Heading><Text>{unavailable ? "The latest notes are temporarily unavailable here. Visit the journal to browse published articles." : "New guides are coming soon: getting started with Micos, choosing model connections and understanding the compute network."}</Text></div><Link href="/docs">Read the documentation<ArrowUpRight size={14} /></Link></div>}</section>;
}

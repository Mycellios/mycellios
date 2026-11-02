import { ArrowUpRight } from "lucide-react";
import { Heading, Link, Text } from "../ui/primitives";
import { comparisons } from "./comparison-data";
import "./compare.css";

export default function ComparePreview() {
  return <section className="compare-preview reference-shell" aria-labelledby="compare-preview-title"><div><Heading as="h2" id="compare-preview-title">Find your<br />kind of agent.</Heading><Text>Different tools, different ways to work. See where Mycellios fits.</Text><Link href="/compare">Explore all comparisons<ArrowUpRight size={15} /></Link></div><nav aria-label="Agent comparisons">{comparisons.map(item => <Link key={item.slug} href={`/compare/${item.slug}`}>Mycellios vs {item.name}<ArrowUpRight size={14} /></Link>)}<Link href="/compare/best-ai-agent-apps">Best AI agent apps<ArrowUpRight size={14} /></Link></nav></section>;
}

import { ArrowUpRight, ChevronDown, Heart, Menu, X } from "lucide-react";
import { Disclosure, DisclosureSummary, Heading, Link, Text } from "../ui/primitives";
import { BrandIcon } from "../ui/BrandIcons";
import { MARKETING_AGENT_URL, SOURCE_URL, MARKETING_PRIMARY_LINKS, MARKETING_EXPLORE_LINKS, MARKETING_FOOTER_GROUPS, MARKETING_SOCIAL_LINKS, marketingDestination, type MarketingActivePage } from "../../../src/contracts/marketing-navigation";
import "../ui/marketing-navigation.js";
import "./marketing-shell.css";

export { MARKETING_AGENT_URL, SOURCE_URL };
export function marketingHref(path: string): string {
  return marketingDestination(path, typeof window === "undefined" ? "" : window.location.hostname);
}

export function MarketingSocialLinks() {
  return <div className="marketing-social" role="group" aria-label="Social links">{MARKETING_SOCIAL_LINKS.map(link => <Link key={link.icon} href={link.href} target="_blank" rel="noreferrer" aria-label={link.label}><BrandIcon name={link.icon} /></Link>)}</div>;
}

function ExploreMenu({ active }: { active?: MarketingActivePage | undefined }) {
  return <Disclosure className="marketing-explore"><DisclosureSummary aria-label="Open Explore menu">Explore<ChevronDown size={13} aria-hidden="true" /></DisclosureSummary><div className="marketing-popover">{MARKETING_EXPLORE_LINKS.map(link => <span key={link.id}>{link.id === "staking" && <Text>$SPORE</Text>}<Link href={marketingHref(link.href)} aria-current={active === link.id ? "page" : undefined}>{link.label}</Link></span>)}</div></Disclosure>;
}

/** `tone="dark"` matches pages with a dark canvas (network observatory, staking) instead of a paper bar. */
export function MarketingHeader({ active, tone }: { active?: MarketingActivePage; tone?: "dark" }) {
  const items = <>{MARKETING_PRIMARY_LINKS.map(link => <Link key={link.id} href={marketingHref(link.href)} aria-current={active === link.id ? "page" : undefined}>{link.label}</Link>)}<ExploreMenu active={active} /></>;
  return <div className="marketing-navigation-surface" data-tone={tone}><header className="marketing-header"><Link className="marketing-brand" href={marketingHref("/")} aria-label="Mycellios home"><img src="/assets/brand/favicon.png" width="30" height="30" alt="" /><span>Mycellios</span></Link><nav className="marketing-desktop-nav" aria-label="Main navigation">{items}</nav><div className="marketing-header-actions"><Link href={marketingHref("/stats")} variant="navigation" size="sm" className="marketing-stats" aria-current={active === "stats" ? "page" : undefined}>Stats</Link><MarketingSocialLinks /></div><Disclosure className="marketing-mobile-menu"><DisclosureSummary className="marketing-menu" aria-label="Open navigation"><Menu className="marketing-open-icon" size={21} /><X className="marketing-close-icon" size={21} /></DisclosureSummary><nav className="marketing-mobile-nav" aria-label="Mobile navigation">{items}<MarketingSocialLinks /></nav></Disclosure></header></div>;
}

export function MarketingFooter() {
  return <footer className="marketing-footer marketing-footer--directory"><div className="marketing-footer-intro"><Link className="marketing-brand" href={marketingHref("/")}><img src="/assets/brand/favicon.png" width="27" height="27" alt="" />Mycellios</Link><Text>AI agents, your models<br />and a network built together.</Text></div><nav aria-label="Footer navigation">{MARKETING_FOOTER_GROUPS.map(group => <div className="marketing-footer-group" key={group.title}><Heading as="h2">{group.title}</Heading>{group.links.map(link => <Link key={link.href} href={marketingHref(link.href)}>{link.label}</Link>)}</div>)}</nav><div className="marketing-footer-bottom"><MarketingSocialLinks /><div className="marketing-footer-meta"><Text as="small">© {new Date().getFullYear()} Mycellios</Text><Text as="small" className="marketing-footer-made">Made with <span role="img" aria-label="love"><Heart size={12} aria-hidden="true" /></span> in Andorra</Text><nav className="marketing-footer-legal" aria-label="Legal"><Link href={marketingHref("/terms")}>Terms</Link><Link href={marketingHref("/privacy")}>Privacy</Link></nav></div></div></footer>;
}

import { ArrowUpRight, ChevronDown, Menu, X } from "lucide-react";
import { Disclosure, DisclosureSummary, Link, Text } from "../ui/primitives";
import { BrandIcon } from "../ui/BrandIcons";
import { MARKETING_AGENT_URL, SOURCE_URL, MARKETING_PRIMARY_LINKS, MARKETING_EXPLORE_LINKS, MARKETING_FOOTER_LINKS, MARKETING_SOCIAL_LINKS, marketingDestination, type MarketingActivePage } from "../../../src/contracts/marketing-navigation";
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

export function MarketingHeader({ active }: { active?: MarketingActivePage }) {
  const items = <>{MARKETING_PRIMARY_LINKS.map(link => <Link key={link.id} href={marketingHref(link.href)} aria-current={active === link.id ? "page" : undefined}>{link.label}</Link>)}<ExploreMenu active={active} /></>;
  return <div className="marketing-navigation-surface"><header className="marketing-header"><Link className="marketing-brand" href={marketingHref("/")} aria-label="Mycellios home"><img src="/assets/brand/favicon.png" width="30" height="30" alt="" /><span>Mycellios</span></Link><nav className="marketing-desktop-nav" aria-label="Main navigation">{items}</nav><div className="marketing-header-actions"><Link href={marketingHref("/dashboard")} variant="navigation" size="sm" className="marketing-stats" aria-current={active === "stats" ? "page" : undefined}>Stats</Link><MarketingSocialLinks /></div><Disclosure className="marketing-mobile-menu"><DisclosureSummary className="marketing-menu" aria-label="Open navigation"><Menu className="marketing-open-icon" size={21} /><X className="marketing-close-icon" size={21} /></DisclosureSummary><nav className="marketing-mobile-nav" aria-label="Mobile navigation">{items}<MarketingSocialLinks /></nav></Disclosure></header></div>;
}

export function MarketingFooter() {
  return <footer className="marketing-footer"><Link className="marketing-brand" href={marketingHref("/")}><img src="/assets/brand/favicon.png" width="27" height="27" alt="" />Mycellios</Link><nav aria-label="Footer navigation">{MARKETING_FOOTER_LINKS.map(link => <Link key={link.href} href={marketingHref(link.href)}>{link.label}{link.href === MARKETING_AGENT_URL && <ArrowUpRight size={13} aria-hidden="true" />}</Link>)}</nav><MarketingSocialLinks /><Text as="small">© {new Date().getFullYear()} Mycellios</Text></footer>;
}

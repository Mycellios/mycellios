import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, Menu, X } from "lucide-react";
import { Button, Disclosure, DisclosureSummary, Link, Text } from "../ui/primitives";
import { BrandIcon } from "../ui/BrandIcons";
import "./marketing-shell.css";

export const MARKETING_AGENT_URL = "https://www.mycellios.com/agent";
export function marketingHref(path: string): string {
  return typeof window !== "undefined" && ["stats.mycellios.com", "stats.localhost"].includes(window.location.hostname) ? `https://www.mycellios.com${path}` : path;
}
export const SOURCE_URL = "https://github.com/Mycellios/mycellios";

export function MarketingSocialLinks() {
  return <div className="marketing-social" role="group" aria-label="Social links"><Link href={SOURCE_URL} target="_blank" rel="noreferrer" aria-label="Mycellios on GitHub"><BrandIcon name="github" /></Link><Link href="https://t.me/mycellios" target="_blank" rel="noreferrer" aria-label="Mycellios on Telegram"><BrandIcon name="telegram" /></Link><Link href="https://x.com/mycellios" target="_blank" rel="noreferrer" aria-label="Mycellios on X"><BrandIcon name="x" /></Link></div>;
}

function ExploreMenu() {
  return <Disclosure className="marketing-explore"><DisclosureSummary aria-label="Open Explore menu">Explore<ChevronDown size={13} aria-hidden="true" /></DisclosureSummary><div className="marketing-popover"><Link href={marketingHref("/#build-api")}>Build with the API</Link><Link href={marketingHref("/compare")}>Compare agents</Link><Link href={marketingHref("/docs")}>Documentation</Link><Text>$SPORE</Text><Link href={marketingHref("/spore")}>Staking</Link><Link href={marketingHref("/spore/rewards")}>Rewards</Link></div></Disclosure>;
}

export function MarketingHeader({ active }: { active?: "network" | "earn" | "stats" | "pricing" }) {
  const [open, setOpen] = useState(false), root = useRef<HTMLElement>(null), toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const closeExplore = () => {
      const disclosures = [...(root.current?.querySelectorAll<HTMLDetailsElement>(".marketing-explore[open]") ?? [])];
      const visible = disclosures.find(disclosure => disclosure.getClientRects().length > 0);
      disclosures.forEach(disclosure => { disclosure.open = false; });
      return visible;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const disclosure = closeExplore();
      if (disclosure) { disclosure.querySelector("summary")?.focus(); return; }
      if (open) { setOpen(false); toggle.current?.focus(); }
    };
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) { closeExplore(); setOpen(false); } };
    window.addEventListener("keydown", escape); window.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("keydown", escape); window.removeEventListener("pointerdown", outside); };
  }, [open]);
  const items = <><Link href={MARKETING_AGENT_URL}>Agent</Link><Link href={marketingHref("/earn")} aria-current={active === "earn" ? "page" : undefined}>Earn</Link><Link href={marketingHref("/pricing")} aria-current={active === "pricing" ? "page" : undefined}>Pricing</Link><ExploreMenu /></>;
  return <header ref={root} className="marketing-header"><Link className="marketing-brand" href={marketingHref("/")} aria-label="Mycellios home"><img src="/assets/brand/favicon.png" width="30" height="30" alt="" /><span>Mycellios</span></Link><nav className="marketing-desktop-nav" aria-label="Main navigation">{items}</nav><div className="marketing-header-actions"><Link href={marketingHref("/dashboard")} variant="primary" size="sm" className="marketing-stats" aria-current={active === "stats" ? "page" : undefined}>Stats</Link><MarketingSocialLinks /></div><Button ref={toggle} className="marketing-menu" variant="ghost" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="marketing-mobile-navigation" onClick={() => setOpen(!open)}>{open ? <X size={21} /> : <Menu size={21} />}</Button>{open && <nav id="marketing-mobile-navigation" className="marketing-mobile-nav" aria-label="Mobile navigation">{items}<MarketingSocialLinks /></nav>}</header>;
}

export function MarketingFooter() {
  return <footer className="marketing-footer"><Link className="marketing-brand" href={marketingHref("/")}><img src="/assets/brand/favicon.png" width="27" height="27" alt="" />Mycellios</Link><nav aria-label="Footer navigation"><Link href={marketingHref("/docs")}>Docs</Link><Link href={marketingHref("/pricing")}>Pricing</Link><Link href={marketingHref("/compare")}>Compare</Link><Link href={marketingHref("/spore/rewards")}>Rewards</Link><Link href={marketingHref("/downloads/desktop")}>Download</Link><Link href={MARKETING_AGENT_URL}>Agent<ArrowUpRight size={13} aria-hidden="true" /></Link></nav><MarketingSocialLinks /><Text as="small">© {new Date().getFullYear()} Mycellios</Text></footer>;
}

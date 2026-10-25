import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, ChevronDown, GitFork, Globe2, Laptop, Menu, X } from "lucide-react";
import { Button, Disclosure, DisclosureSummary, Heading, Link, Text } from "../ui/primitives";
import { applySeoMetadata } from "../seo";
import { AGENT_URL, AssemblageAgent } from "./AssemblageAgent";
import { AssemblageApi, AssemblageNetwork } from "./AssemblageNetwork";
import "./assemblage-landing.css";

const source = "https://github.com/Mycellios/mycellios";
const logo = "/assets/brand/favicon.png";

function Brand() {
  return <Link href="/" className="assembly-brand" aria-label="Mycellios home"><img src={logo} width="36" height="36" alt="" /><span>Mycellios</span></Link>;
}

function Header() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    const outside = (event: PointerEvent) => { if (!navigation.current?.contains(event.target as Node) && !toggle.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("keydown", close); window.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("keydown", close); window.removeEventListener("pointerdown", outside); };
  }, [open]);
  const links = <><Link href="#network" onClick={() => setOpen(false)}>Network</Link><Link href="#agent" onClick={() => setOpen(false)}>Agent</Link><Link href="#contribute" onClick={() => setOpen(false)}>Contribute</Link><Link href="/docs">Docs</Link></>;
  return <header className="assembly-header assembly-shell"><Brand /><nav className="assembly-desktop-nav" aria-label="Main navigation">{links}</nav><Link href={AGENT_URL} variant="primary" className="assembly-header-action">Open Agent<ArrowUpRight size={17} /></Link><Button ref={toggle} variant="ghost" className="assembly-menu-toggle" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="assembly-mobile-navigation" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</Button>{open && <nav ref={navigation} id="assembly-mobile-navigation" className="assembly-mobile-nav" aria-label="Mobile navigation">{links}<Link href={AGENT_URL} variant="primary">Open Agent<ArrowUpRight size={17} /></Link></nav>}</header>;
}

export function AssemblageHero() {
  const art = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = art.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.matchMedia("(pointer: fine)").matches) return;
    let frame = 0;
    const move = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = element.getBoundingClientRect();
        element.style.setProperty("--assembly-drift-x", `${((event.clientX - bounds.left) / bounds.width - .5) * 12}px`);
        element.style.setProperty("--assembly-drift-y", `${((event.clientY - bounds.top) / bounds.height - .5) * 7}px`);
      });
    };
    const reset = () => { cancelAnimationFrame(frame); element.style.setProperty("--assembly-drift-x", "0px"); element.style.setProperty("--assembly-drift-y", "0px"); };
    element.addEventListener("pointermove", move); element.addEventListener("pointerleave", reset);
    return () => { cancelAnimationFrame(frame); element.removeEventListener("pointermove", move); element.removeEventListener("pointerleave", reset); };
  }, []);
  return <section className="assembly-hero" aria-labelledby="assembly-title" id="assembly-content"><div className="assembly-hero-intro assembly-shell"><Heading as="h1" id="assembly-title">Open infrastructure<br />for distributed AI.</Heading><div className="assembly-hero-copy"><Text>Work with Mycellios Agent, build with the API, or connect a compatible device.</Text><div className="assembly-actions"><Link href="/network" variant="primary" size="xl">Explore the network<ArrowRight size={18} /></Link><Link href={AGENT_URL} variant="secondary" size="xl">Open Agent<ArrowUpRight size={18} /></Link></div></div></div><figure className="assembly-hero-figure"><div className="assembly-hero-art" ref={art}><img src="/assets/landing/assemblage-network.webp" width="2056" height="765" fetchPriority="high" alt="A sculptural network of compute islands joined by branching ivory mycelium, with multiple connections between devices" /></div><figcaption className="assembly-shell">A network concept, rooted in connection.</figcaption></figure></section>;
}

function Contribution() {
  const [native, setNative] = useState(true);
  return <section className="assembly-contribute assembly-shell" id="contribute" aria-labelledby="assembly-contribute-title"><div><Heading as="h2" id="assembly-contribute-title">Your device.<br />Part of the network.</Heading><Text>Choose how much to share. Pause whenever you need to.</Text></div><div className="assembly-contribution-options"><div role="group" aria-label="Choose a contribution setup"><Button variant="ghost" aria-pressed={native} onClick={() => setNative(true)}><Laptop size={20} />On your computer</Button><Button variant="ghost" aria-pressed={!native} onClick={() => setNative(false)}><Globe2 size={20} />In your browser</Button></div><div className="assembly-contribution-detail" aria-live="polite"><Heading as="h3">{native ? "A home for a node." : "Start with a tab."}</Heading><Text>{native ? "Find the native package for your system and connect a compatible runtime." : "Open the browser worker on a WebGPU-compatible device. Keep the tab open while it runs."}</Text><Link variant="primary" href={native ? "/downloads" : "/browser/"}>{native ? "See downloads" : "Open browser worker"}<ArrowRight size={17} /></Link></div></div></section>;
}

export function AssemblageLanding() {
  useEffect(() => { applySeoMetadata("/"); }, []);
  return <main className="mycellios-assemblage" id="assembly-top"><Link className="assembly-skip" href="#assembly-content">Skip to content</Link><Header /><AssemblageHero />
    <section className="assembly-network assembly-shell" id="network" aria-labelledby="assembly-network-title"><div className="assembly-section-intro"><Heading as="h2" id="assembly-network-title">A shared layer<br />for intelligence.</Heading><div><Text>Individual devices. Connected capacity. Mycellios coordinates models and requests across available compute.</Text><Link className="assembly-text-action" href="/dashboard">See models and activity<ArrowUpRight size={17} /></Link></div></div><div className="assembly-network-body"><div className="assembly-network-copy"><AssemblageApi /></div><AssemblageNetwork /></div></section>
    <section className="assembly-agent-section" id="agent" aria-labelledby="assembly-agent-title"><div className="assembly-shell"><div className="assembly-agent-intro"><img src={logo} width="45" height="45" alt="" /><Heading as="h2" id="assembly-agent-title">A workspace for<br />your next idea.</Heading><Text>Conversations, models and tools, together in Mycellios Agent.</Text><Link variant="primary" size="xl" href={AGENT_URL}>Open Mycellios Agent<ArrowRight size={18} /></Link></div><AssemblageAgent /></div></section>
    <Contribution />
    <section className="assembly-questions assembly-shell" aria-labelledby="assembly-questions-title"><Heading as="h2" id="assembly-questions-title">Before you start.</Heading><div><Disclosure><DisclosureSummary>Do I need to contribute to use Agent?<ChevronDown size={18} /></DisclosureSummary><Text>No. Open Agent and configure a supported model connection. Contributing compute is optional.</Text></Disclosure><Disclosure><DisclosureSummary>Where is the network today?<ChevronDown size={18} /></DisclosureSummary><Text>Mycellios is in active development. The <Link href="/network">network view</Link> shows observed activity and the <Link href="/dashboard">panel</Link> lists available models. <Link href={`${source}/blob/main/docs/STATUS_AND_EVIDENCE.md`}>Read the implementation status.</Link></Text></Disclosure></div></section>
    <footer className="assembly-footer"><div className="assembly-shell"><div className="assembly-footer-intro"><Heading as="h2">Better connected.</Heading><Link href={source} className="assembly-text-action"><GitFork size={20} />Built in the open<ArrowUpRight size={16} /></Link></div><div className="assembly-footer-links"><nav aria-label="Product links"><Link href={AGENT_URL}>Mycellios Agent</Link><Link href="/network">Network</Link><Link href="/earn">Contribute</Link><Link href="/create">Create</Link><Link href="/spore">SPORE</Link></nav><nav aria-label="Resources"><Link href="/docs">Documentation</Link><Link href="/downloads">Downloads</Link><Link href="mailto:hello@mycellios.com">Contact</Link></nav></div><div className="assembly-wordmark" aria-hidden="true">Mycellios</div><div className="assembly-footer-bottom"><span>© {new Date().getFullYear()} Mycellios</span><Link href="#assembly-top">Back to top<ArrowUpRight size={15} /></Link></div></div></footer>
  </main>;
}

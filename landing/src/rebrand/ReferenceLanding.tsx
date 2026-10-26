import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Copy, GitFork, Globe2, Laptop, Menu, X } from "lucide-react";
import { Button, Disclosure, DisclosureSummary, Heading, Link, Text } from "../ui/primitives";
import { BrandIcon } from "../ui/BrandIcons";
import { applySeoMetadata } from "../seo";
import { AGENT_URL, AssemblageAgent } from "./AssemblageAgent";
import { NetworkPrint, type NetworkArtwork } from "./NetworkPrint";
import { SporeMenu } from "./SporeMenu";
import "./assemblage-landing.css";
import "./reference-landing.css";

const source = "https://github.com/Mycellios/mycellios";
const endpoint = "https://www.mycellios.com/v1";
const logo = "/assets/brand/favicon.png";

function ReferenceSocialLinks() {
  return <div className="reference-social-links" role="group" aria-label="Social links"><Link href={source} target="_blank" rel="noreferrer" aria-label="Mycellios on GitHub"><BrandIcon name="github" /></Link><Link href="https://x.com/mycellios" target="_blank" rel="noreferrer" aria-label="Mycellios on X"><BrandIcon name="x" /></Link><Link href="https://t.me/mycellios" target="_blank" rel="noreferrer" aria-label="Mycellios on Telegram"><BrandIcon name="telegram" /></Link></div>;
}

export function ReferenceHeader() {
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const closeSpore = () => {
      const disclosure = header.current?.querySelector<HTMLDetailsElement>(".spore-menu[open]");
      if (disclosure) disclosure.open = false;
      return disclosure;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const disclosure = closeSpore();
      if (disclosure) { disclosure.querySelector("summary")?.focus(); return; }
      if (open) { setOpen(false); toggle.current?.focus(); }
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !header.current?.contains(event.target)) {
        closeSpore(); setOpen(false);
      }
    };
    window.addEventListener("keydown", escape);
    window.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("keydown", escape); window.removeEventListener("pointerdown", outside); };
  }, [open]);
  const items = <><Link href={AGENT_URL}>Agent</Link><Link href="/create">Create</Link><Link href="/earn">Earn</Link><SporeMenu label="Token" treasuryLabel="Treasure" menuLabel="Open Token menu" /><Link href="/network">Live network</Link></>;
  return <header ref={header} className="reference-header reference-shell"><Link className="reference-brand" href="/" aria-label="Mycellios home"><img src={logo} width="30" height="30" alt="" /><span>Mycellios</span></Link><nav aria-label="Main navigation">{items}</nav><div className="reference-header-actions"><ReferenceSocialLinks /><Link href="/dashboard" variant="primary" className="reference-header-login">Login</Link></div><Button ref={toggle} variant="ghost" className="reference-menu" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="reference-mobile-navigation" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</Button>{open && <nav id="reference-mobile-navigation" className="reference-mobile-navigation" aria-label="Mobile navigation">{items}<ReferenceSocialLinks /><Link href="/dashboard" variant="primary" className="reference-header-login">Login</Link></nav>}</header>;
}

function ConnectionPanel() {
  const [tab, setTab] = useState<"api" | "device">("api");
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function copy() {
    try { await navigator.clipboard.writeText(endpoint); setCopied(true); setFailed(false); timer.current = window.setTimeout(() => setCopied(false), 2500); }
    catch { setFailed(true); }
  }
  return <div className="reference-connect"><div className="reference-connect-tabs" role="group" aria-label="Connect to Mycellios"><Button variant="ghost" aria-pressed={tab === "api"} onClick={() => setTab("api")}>Build with the API</Button><Button variant="ghost" aria-pressed={tab === "device"} onClick={() => setTab("device")}>Connect a device</Button></div><div className="reference-connect-content" aria-live="polite">{tab === "api" ? <><div className="reference-endpoint"><code>{endpoint}</code><Button variant="ghost" aria-label="Copy API endpoint" onClick={() => void copy()}>{copied ? <Check size={17} /> : <Copy size={17} />}</Button></div><div className="reference-connect-bottom"><span>{failed ? "Select the endpoint to copy it manually." : copied ? "Endpoint copied" : "OpenAI-compatible API"}</span><Link href="/docs">Read the docs<ArrowUpRight size={14} /></Link></div></> : <><Link className="reference-device-action" href="/downloads"><Laptop size={21} /><span>On your computer<small>Native packages</small></span><ArrowUpRight size={17} /></Link><Link className="reference-device-action" href="/browser/"><Globe2 size={21} /><span>In your browser<small>Requires WebGPU</small></span><ArrowUpRight size={17} /></Link></>}</div></div>;
}

function NetworkStory({ artwork }: { artwork: NetworkArtwork }) {
  return <div className="reference-network-story"><div className="reference-world-visual" role="img" aria-label={artwork === "fruiting" ? "Conceptual computing fabric with mushrooms growing from branching mycelium" : "Conceptual computing fabric: four computer modules connected by branching mycelium"}><NetworkPrint artwork={artwork} /></div><section className="reference-network-chapter reference-shell" id="network" aria-labelledby="reference-network-title"><div className="reference-network-copy"><Heading as="h2" id="reference-network-title">Build on <br />the network.</Heading><Text>Mycellios brings models, requests and available compute into one open network.</Text><Link className="reference-status-link" href="/dashboard">See available models<ArrowUpRight size={14} /></Link></div><ConnectionPanel /></section><div className="reference-world-caption reference-shell"><span>Computing fabric concept. The network vision includes personal devices and servers.</span><Link href="/downloads">Check current support<ArrowUpRight size={13} /></Link></div></div>;
}

export function ReferenceLanding({ initialArtwork }: { initialArtwork?: NetworkArtwork } = {}) {
  const artwork = initialArtwork ?? (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("art") === "fabric" ? "fabric" : "fruiting");
  useEffect(() => { applySeoMetadata("/"); }, []);
  return <main className="mycellios-assemblage mycellios-reference" id="reference-top"><Link className="assembly-skip" href="#reference-content">Skip to content</Link><ReferenceHeader />
    <section className="reference-hero reference-shell" id="reference-content" aria-labelledby="reference-title"><Heading as="h1" id="reference-title">Many machines. <br />One shared network.</Heading><Text>Open infrastructure for distributed AI. <br />Work with Agent, build with the API, or bring your compute.</Text><div className="reference-hero-actions"><Link href="/network" variant="primary" size="xl">Explore the network<ArrowRight size={17} /></Link><Link href={AGENT_URL} variant="secondary" size="xl">Open Agent<ArrowUpRight size={17} /></Link></div></section>
    <NetworkStory artwork={artwork} />
    <section className="reference-agent reference-shell" id="agent" aria-labelledby="reference-agent-title"><Heading as="h2" id="reference-agent-title">Meet Mycellios Agent.</Heading><Text>Conversations, models and tools in one workspace.</Text><Link variant="primary" size="xl" href={AGENT_URL}>Open Mycellios Agent<ArrowRight size={17} /></Link><AssemblageAgent expanded /></section>
    <section className="reference-contribute reference-shell" id="contribute" aria-labelledby="reference-contribute-title"><div><Heading as="h2" id="reference-contribute-title">Bring your<br />spare compute.</Heading><Text>Connect a compatible device. Choose your limits.<br />Pause when you need to.</Text></div><div className="reference-contribute-links"><Link href="/downloads"><Laptop size={25} /><span>On your computer<small>Find a native package for your system.</small></span><ArrowRight size={20} /></Link><Link href="/browser/"><Globe2 size={25} /><span>In your browser<small>Open a worker on a WebGPU-compatible device.</small></span><ArrowRight size={20} /></Link></div></section>
    <section className="reference-questions reference-shell" aria-labelledby="reference-questions-title"><Heading as="h2" id="reference-questions-title">A few questions.</Heading><div><Disclosure><DisclosureSummary>Do I need to contribute to use Agent?<ChevronDown size={18} /></DisclosureSummary><Text>No. Open Agent and configure a supported model connection. Contributing compute is optional.</Text></Disclosure><Disclosure><DisclosureSummary>What can connect to the network?<ChevronDown size={18} /></DisclosureSummary><Text>Browser workers need WebGPU support. Native support depends on your system and runtime. <Link href="/downloads">Check the available packages.</Link></Text></Disclosure><Disclosure><DisclosureSummary>Where is Mycellios today?<ChevronDown size={18} /></DisclosureSummary><Text>Mycellios is in active development. <Link href="/network">Explore observed activity</Link> or <Link href={`${source}/blob/main/docs/STATUS_AND_EVIDENCE.md`}>read the implementation status.</Link></Text></Disclosure></div></section>
    <footer className="reference-footer reference-shell"><Link className="reference-brand" href="/"><img src={logo} width="27" height="27" alt="" />Mycellios</Link><nav aria-label="Footer navigation"><Link href="/docs">Docs</Link><Link href={source}><GitFork size={15} />GitHub</Link><Link href="/create">Create</Link><Link href="/spore">SPORE</Link><Link href="/earn">Contribute</Link><Link href={AGENT_URL}>Agent<ArrowUpRight size={14} /></Link></nav><span>© {new Date().getFullYear()} Mycellios</span></footer>
  </main>;
}

import { useEffect, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, Copy, GitFork, Globe2, Laptop, Menu, X } from "lucide-react";
import { Button, Disclosure, DisclosureSummary, Heading, Link, Text } from "../ui/primitives";
import { applySeoMetadata } from "../seo";
import { NetworkWeave, RequestDiagram } from "./NetworkWeave";
import "./rooted-landing.css";

const AGENT = "https://www.mycellios.com/agent";
const SOURCE = "https://github.com/Mycellios/mycellios";
const ENDPOINT = "https://www.mycellios.com/v1";
const logo = "/assets/brand/favicon.png";

function RootedBrand() {
  return <Link className="rooted-brand" href="/" aria-label="Mycellios home"><img src={logo} alt="" width="34" height="34" /><span>Mycellios</span></Link>;
}

function RootedHeader() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const links = <><Link href="#network" onClick={() => setOpen(false)}>Network</Link><Link href="#agent" onClick={() => setOpen(false)}>Agent</Link><Link href="#contribute" onClick={() => setOpen(false)}>Contribute</Link><Link href="/docs">Docs</Link></>;
  return <header className="rooted-header rooted-shell"><RootedBrand /><nav aria-label="Main navigation" className="rooted-nav">{links}</nav><Link href="/dashboard" className="rooted-panel-link">Open panel <ArrowUpRight size={16} /></Link><Button className="rooted-menu-button" variant="ghost" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="rooted-mobile-nav" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</Button>{open && <nav id="rooted-mobile-nav" className="rooted-mobile-nav" aria-label="Mobile navigation">{links}<Link href="/dashboard">Open panel <ArrowUpRight size={16} /></Link></nav>}</header>;
}

export function ApiSample() {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [status]);
  async function copy() {
    try { await navigator.clipboard.writeText(ENDPOINT); setStatus("copied"); }
    catch { setStatus("failed"); }
  }
  return <div className="rooted-api-sample"><div><span>OpenAI-compatible endpoint</span><Button variant="ghost" onClick={() => void copy()} aria-label="Copy API endpoint">{status === "copied" ? <Check size={17} /> : <Copy size={17} />}{status === "copied" ? "Copied" : "Copy"}</Button></div><pre><code>{ENDPOINT}</code></pre><Text aria-live="polite">{status === "failed" ? "Select the endpoint to copy it manually." : "Choose an available model and connect your client."}</Text></div>;
}

function ContributeChoice() {
  const [native, setNative] = useState(false);
  return <div className="rooted-contribution-choice"><div className="rooted-contribution-tabs" role="group" aria-label="Contribution setup"><Button variant="ghost" aria-pressed={!native} onClick={() => setNative(false)}><Globe2 size={18} />Browser</Button><Button variant="ghost" aria-pressed={native} onClick={() => setNative(true)}><Laptop size={18} />Computer</Button></div><div className="rooted-contribution-detail" aria-live="polite"><span className="rooted-choice-illustration" aria-hidden="true">{native ? <Laptop /> : <Globe2 />}</span><div><Heading as="h3">{native ? "Make room for a node." : "Start with a tab."}</Heading><Text>{native ? "Find the native package for your system and connect a supported runtime." : "Choose your power level and keep the browser worker open while it runs."}</Text><Link variant="primary" href={native ? "/downloads" : "/browser/"}>{native ? "See downloads" : "Open browser worker"}<ArrowRight size={17} /></Link></div></div></div>;
}

export function RootedLanding() {
  useEffect(() => { applySeoMetadata("/"); }, []);
  return <main className="mycellios-rooted" id="rooted-top"><Link href="#rooted-content" className="rooted-skip">Skip to content</Link><RootedHeader />
    <section className="rooted-hero rooted-shell" id="rooted-content" aria-labelledby="rooted-title"><div className="rooted-hero-copy"><Heading as="h1" id="rooted-title">AI beyond<br />one machine.</Heading><Text className="rooted-lede">An open network for distributed AI. Explore the network, work with Agent, or connect a compatible device.</Text><div className="rooted-actions"><Link href="/network" variant="primary" size="lg">Explore the network <ArrowUpRight size={18} /></Link><Link href={AGENT} className="rooted-plain-action">Open Agent <ArrowUpRight size={16} /></Link></div></div><NetworkWeave /><Link className="rooted-discover" href="#network"><ArrowDown size={16} />Grown from individual devices.</Link></section>

    <section className="rooted-network" id="network" aria-labelledby="rooted-network-title"><div className="rooted-shell"><div className="rooted-network-intro"><Heading as="h2" id="rooted-network-title">A shared layer<br />for intelligence.</Heading><div><Text>Like mycelium, the strength is in the connections. Mycellios coordinates models, requests and available compute through a common interface.</Text><Link href="/dashboard" className="rooted-plain-action">See models and activity <ArrowUpRight size={17} /></Link></div></div><RequestDiagram /><div className="rooted-build"><div><Heading as="h3">Build on familiar ground.</Heading><Text>Connect your tools through the OpenAI-compatible API. The panel shows which models and routes are available.</Text><Link href="/docs" className="rooted-plain-action">Read the documentation <ArrowUpRight size={16} /></Link></div><ApiSample /></div></div></section>

    <section className="rooted-agent rooted-shell" id="agent" aria-labelledby="rooted-agent-title"><div className="rooted-agent-art" aria-hidden="true"><svg viewBox="0 0 500 440"><g className="rooted-agent-branches" fill="none"><path d="M250 221 Q170 202 104 100 M250 221 Q254 123 310 60 M250 221 Q328 192 399 126 M250 221 Q325 253 403 331 M250 221 Q234 321 282 388 M250 221 Q156 276 92 333" /><circle cx="104" cy="100" r="16" /><circle cx="310" cy="60" r="12" /><circle cx="399" cy="126" r="15" /><circle cx="403" cy="331" r="12" /><circle cx="282" cy="388" r="14" /><circle cx="92" cy="333" r="12" /></g><circle className="rooted-agent-center" cx="250" cy="221" r="63" /></svg><img src={logo} alt="" width="62" height="62" /><span>Mycellios Agent</span></div><div className="rooted-agent-copy"><Heading as="h2" id="rooted-agent-title">A space for<br />your next idea.</Heading><Text>Mycellios Agent brings conversations, models and tools into one workspace. Choose a supported connection and get to work.</Text><Link href={AGENT} variant="primary" size="lg">Open Mycellios Agent <ArrowUpRight size={18} /></Link><Text className="rooted-secondary-copy">Using Agent and contributing compute are separate ways to take part.</Text></div></section>

    <section className="rooted-contribute rooted-shell" id="contribute" aria-labelledby="rooted-contribute-title"><div className="rooted-contribute-copy"><Heading as="h2" id="rooted-contribute-title">Let your device<br />be part of it.</Heading><Text>Share what fits your day. Choose your limits and pause whenever you need to.</Text><Link href="/earn" className="rooted-plain-action">About contributing <ArrowUpRight size={16} /></Link></div><ContributeChoice /></section>

    <section className="rooted-questions rooted-shell" aria-labelledby="rooted-questions-title"><Heading as="h2" id="rooted-questions-title">Before you start.</Heading><div><Disclosure><DisclosureSummary>Do I need a device to use Agent?<ChevronDown size={19} /></DisclosureSummary><Text>No. Open Agent and configure a supported model connection. Contributing compute is optional.</Text></Disclosure><Disclosure><DisclosureSummary>What hardware can contribute?<ChevronDown size={19} /></DisclosureSummary><Text>Browser contribution requires WebGPU support. Native compatibility depends on your system and runtime. <Link href="/downloads">See available packages.</Link></Text></Disclosure><Disclosure><DisclosureSummary>Where is the network today?<ChevronDown size={19} /></DisclosureSummary><Text>Mycellios is in active development. The <Link href="/network">network view</Link> shows observed activity; the <Link href="/dashboard">panel</Link> lists available models and devices. <Link href={`${SOURCE}/blob/main/docs/STATUS_AND_EVIDENCE.md`}>Read the implementation status.</Link></Text></Disclosure></div></section>

    <footer className="rooted-footer"><div className="rooted-shell"><div className="rooted-footer-top"><Heading as="h2">Built in the open.<br />Better connected.</Heading><Link href={SOURCE} className="rooted-plain-action"><GitFork size={19} />Explore the source <ArrowUpRight size={16} /></Link></div><div className="rooted-footer-links"><nav aria-label="Product links"><Link href={AGENT}>Mycellios Agent</Link><Link href="/network">Network</Link><Link href="/create">Create</Link><Link href="/spore">SPORE</Link></nav><nav aria-label="Resources"><Link href="/docs">Documentation</Link><Link href="/downloads">Downloads</Link><Link href="mailto:hello@mycellios.com">Contact</Link></nav></div><div className="rooted-wordmark" aria-hidden="true">Mycellios</div><div className="rooted-footer-bottom"><span>© {new Date().getFullYear()} Mycellios</span><Link href="#rooted-top">Back to top <ArrowUpRight size={15} /></Link></div></div></footer>
  </main>;
}

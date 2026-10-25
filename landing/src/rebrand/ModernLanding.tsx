import { useEffect, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Bot, ChevronDown, Code2, FileText, GitFork, Globe2, Laptop, Layers, Lightbulb, Menu, Plus, Server, ShieldCheck, Smartphone, X } from "lucide-react";
import { Button, Card, Disclosure, DisclosureSummary, Heading, Link, Text } from "../ui/primitives";
import { applySeoMetadata } from "../seo";
import { HeroGlobe } from "./HeroGlobe";
import { FruitingMark } from "./FruitingMark";
import "./modern-landing.css";

const AGENT = "https://www.mycellios.com/agent";
const SOURCE = "https://github.com/Mycellios/mycellios";
const logo = "/assets/brand/favicon.png";
const startingPoints = [
  { title: "Plan a project", icon: Layers, prompt: "Turn an idea into a practical plan.", detail: "Bring the context. Work through the questions. Find your next step." },
  { title: "Understand a document", icon: FileText, prompt: "Make sense of the details.", detail: "Keep your material and the conversation in one workspace." },
  { title: "Explore an idea", icon: Lightbulb, prompt: "Follow a question somewhere useful.", detail: "Choose your model and give the conversation room to grow." },
];

function HomeBrand() {
  return <Link className="home-brand" href="/" aria-label="Mycellios home"><img src={logo} alt="" /><span>Mycellios</span></Link>;
}

function HomeHeader() {
  const [open, setOpen] = useState(false);
  const navigation = <><Link href="#agent" onClick={() => setOpen(false)}>Agent</Link><Link href="#network" onClick={() => setOpen(false)}>The network</Link><Link href="#contribute" onClick={() => setOpen(false)}>Contribute</Link><Link href="/docs">Docs <ArrowUpRight size={13} /></Link></>;
  return <header className="home-header"><div className="home-shell home-header-inner"><HomeBrand />
    <nav className="home-desktop-nav" aria-label="Main navigation">{navigation}</nav>
    <div className="home-header-actions"><Link className="home-panel-link" href="/dashboard">Network panel</Link><Link variant="primary" href={AGENT}>Open Agent <ArrowUpRight size={15} /></Link></div>
    <Button className="home-menu-toggle" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="home-mobile-nav" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</Button>
    {open && <nav id="home-mobile-nav" className="home-mobile-nav" aria-label="Mobile navigation">{navigation}<Link href="/dashboard">Network panel</Link><Link variant="primary" href={AGENT}>Open Mycellios Agent <ArrowUpRight size={16} /></Link></nav>}
  </div></header>;
}

function GrowingWorld() {
  return <div className="home-world" aria-hidden="true"><div className="home-world-orbit"><HeroGlobe />
    <div className="home-world-center"><FruitingMark /><span>Shared roots.</span></div>
    <span className="home-world-node node-a"><Laptop size={18} /><span>Your device</span></span>
    <span className="home-world-node node-b"><Bot size={18} /><span>Your agent</span></span>
    <span className="home-world-node node-c"><Server size={18} /><span>Open compute</span></span>
  </div><span className="home-world-caption"><span />Independent minds. Connected possibilities.</span></div>;
}

export function AgentPreview() {
  const [selected, setSelected] = useState(0);
  const example = startingPoints[selected]!;
  return <div className="home-agent-preview" aria-label="Mycellios Agent interface preview">
    <div className="home-preview-bar"><span><i /><i /><i /></span><span>Mycellios Agent</span><span><ShieldCheck size={13} />Your workspace</span></div>
    <div className="home-preview-body"><aside className="home-preview-sidebar"><span className="home-preview-label">START SOMETHING</span>
      {startingPoints.map((item, index) => <Button key={item.title} className={index === selected ? "selected" : ""} aria-pressed={selected === index} onClick={() => setSelected(index)}><item.icon size={16} /><span>{item.title}</span></Button>)}
      <div className="home-preview-sidebar-foot"><img src={logo} alt="" /><span>Room to think.</span></div>
    </aside><div className="home-preview-conversation"><span className="home-preview-model"><span />Your choice of model</span><div className="home-preview-welcome" aria-live="polite"><img src={logo} alt="" /><Heading as="h3">{example.prompt}</Heading><Text>{example.detail}</Text></div>
      <div className="home-preview-composer"><Plus size={18} /><span>What would you like to work on?</span><Link variant="primary" href={AGENT} aria-label="Continue in Mycellios Agent"><ArrowUpRight size={18} /></Link></div>
    </div></div><div className="home-preview-caption">A look inside Agent <span>Conversations happen in your workspace.</span><Link href={AGENT}>Open yours <ArrowUpRight size={13} /></Link></div>
  </div>;
}

function NetworkIllustration() {
  return <div className="home-network-map" role="img" aria-label="A shared network connecting a laptop, a phone and a server through multiple paths">
    <svg viewBox="0 0 540 340" aria-hidden="true"><path d="M85 85 Q270 0 450 95 M85 85 Q20 220 145 280 M145 280 Q350 335 450 95 M85 85 Q260 160 450 95 M145 280 Q240 200 270 155 M270 155 Q335 200 450 95 M85 85 L270 155" /></svg>
    <span className="home-peer peer-laptop"><Laptop /><small>Laptop</small></span><span className="home-peer peer-phone"><Smartphone /><small>Phone</small></span><span className="home-peer peer-server"><Server /><small>Server</small></span><span className="home-peer peer-hub"><img src={logo} alt="" /><small>Mycellios</small></span>
  </div>;
}

export function ModernLanding() {
  useEffect(() => { applySeoMetadata("/"); }, []);
  return <main className="mycellios-home" id="home-top"><Link className="home-skip" href="#home-content">Skip to content</Link><HomeHeader />
    <section className="home-shell home-hero" id="home-content" aria-labelledby="home-title"><div className="home-hero-copy"><span className="home-eyebrow"><span />INTELLIGENCE, CONNECTED.</span><Heading as="h1" id="home-title">Useful AI.<br /><span>Shared roots.</span></Heading><Text className="home-lede">A workspace for your agents.<br />A growing network for your compute.</Text><div className="home-actions"><Link variant="primary" href={AGENT}>Open Mycellios Agent <ArrowUpRight size={17} /></Link><Link className="home-text-action" href="#network">Explore the network <ArrowRight size={16} /></Link></div><span className="home-hero-note">Open models. Independent choices. More possibilities.</span></div><GrowingWorld /></section>

    <div className="home-shell home-intro-strip"><span><Bot size={18} />A place to get things done.</span><span><GitFork size={18} />A network to build together.</span><Link href="#agent" aria-label="Discover Mycellios"><ArrowDown size={18} /></Link></div>

    <section className="home-shell home-section home-agent" id="agent" aria-labelledby="home-agent-title"><div className="home-section-head"><div><span className="home-eyebrow">01 / MYCELLIOS AGENT</span><Heading as="h2" id="home-agent-title">Less switching.<br /><span>More moving forward.</span></Heading></div><div><Text>Bring your questions, context and models into one workspace. Make space for the work that matters to you.</Text><Link className="home-text-action" href={AGENT}>Meet your Agent <ArrowUpRight size={16} /></Link></div></div><AgentPreview />
      <div className="home-agent-principles"><div><Layers size={20} /><Heading as="h3">Your model.</Heading><Text>Choose a supported connection that fits the task.</Text></div><div><FileText size={20} /><Heading as="h3">Your context.</Heading><Text>Keep the conversation and its next steps together.</Text></div><div><ShieldCheck size={20} /><Heading as="h3">Your say.</Heading><Text>Decide which actions need your approval.</Text></div></div>
    </section>

    <section className="home-network" id="network" aria-labelledby="home-network-title"><div className="home-shell"><div className="home-network-top"><div><span className="home-eyebrow">02 / THE COMPUTE NETWORK</span><Heading as="h2" id="home-network-title">Many devices.<br /><span>One shared direction.</span></Heading><Text>Mycellios connects available compute with models and requests. Explore the network, see its capacity, and find a place for your device.</Text><Link className="home-light-action" href="/network">View the network <ArrowUpRight size={17} /></Link></div><NetworkIllustration /></div>
      <div className="home-api-row"><div><Code2 size={21} /><Heading as="h3">A familiar way to build.</Heading><Text>An OpenAI-compatible API, with model and route availability visible in the panel.</Text><Link href="/docs">Read the API docs <ArrowUpRight size={15} /></Link></div><div className="home-code"><div><span>MYCELLIOS API</span><span>HTTP</span></div><pre><code><span>POST</span> /v1/chat/completions{"\n\n"}{'{'}{"\n"}{'  "model": "<available-model>",'}{"\n"}{'  "messages": [{ "role": "user", "content": "Hello" }]'}{"\n"}{'}'}</code></pre></div></div>
    </div></section>

    <section className="home-shell home-section home-contribute" id="contribute" aria-labelledby="home-contribute-title"><div className="home-section-head"><div><span className="home-eyebrow">03 / GROW WITH US</span><Heading as="h2" id="home-contribute-title">Your spare capacity.<br /><span>A useful new role.</span></Heading></div><Text>Share what fits your device and your day. Choose your limits, and pause when you need to.</Text></div><div className="home-contribute-grid"><Card className="home-contribute-card"><div className="home-device-icon"><Globe2 /></div><span className="home-card-tag">THE EASY WAY IN</span><Heading as="h3">Start with a browser.</Heading><Text>Open the worker on a compatible browser. Choose how much to share and keep the tab open while it runs.</Text><Link href="/browser/" variant="primary">Open browser worker <ArrowUpRight size={16} /></Link></Card><Card className="home-contribute-card"><div className="home-device-icon"><Laptop /></div><span className="home-card-tag">A MORE DEDICATED SETUP</span><Heading as="h3">Connect your computer.</Heading><Text>Explore native packages for your system. Available downloads and supported runtimes are listed in the panel.</Text><Link className="home-text-action" href="/downloads">See downloads <ArrowRight size={16} /></Link></Card></div></section>

    <section className="home-shell home-open"><div><GitFork size={22} /><Heading as="h2">Open at the roots.</Heading><Text>Explore the code, follow the work, or make a contribution.</Text></div><Link href={SOURCE}>Mycellios on GitHub <ArrowUpRight size={16} /></Link></section>

    <section className="home-shell home-section home-faq" aria-labelledby="home-faq-title"><div><span className="home-eyebrow">A LITTLE MORE CONTEXT</span><Heading as="h2" id="home-faq-title">Good questions.</Heading></div><div>
      <Disclosure><DisclosureSummary>What is Mycellios Agent?<ChevronDown size={18} /></DisclosureSummary><Text>Agent is your workspace for conversations, models and tools. Open it in your browser and choose a supported model connection to get started.</Text></Disclosure>
      <Disclosure><DisclosureSummary>Do I need to contribute a device to use Agent?<ChevronDown size={18} /></DisclosureSummary><Text>No. Using Agent and contributing compute are separate ways to take part. Configure a model connection in Agent, or visit the contribution page to connect a device.</Text></Disclosure>
      <Disclosure><DisclosureSummary>Which devices can contribute?<ChevronDown size={18} /></DisclosureSummary><Text>The browser worker requires a compatible browser. Native support depends on your system, hardware and the packages currently published. <Link href="/downloads">Check downloads <ArrowUpRight size={13} /></Link></Text></Disclosure>
      <Disclosure><DisclosureSummary>Where can I see the network?<ChevronDown size={18} /></DisclosureSummary><Text>The <Link href="/network">network view</Link> shows observed activity. Open the <Link href="/dashboard">panel</Link> for models, devices and history.</Text></Disclosure>
    </div></section>

    <section className="home-closing"><div className="home-shell"><img src={logo} alt="" /><Heading as="h2">Start with an idea.<br /><span>See where it grows.</span></Heading><div className="home-actions"><Link variant="primary" href={AGENT}>Open Mycellios Agent <ArrowUpRight size={17} /></Link><Link className="home-text-action" href="/earn">Contribute compute <ArrowRight size={16} /></Link></div></div></section>

    <footer className="home-shell home-footer"><div className="home-footer-top"><div><HomeBrand /><Text>Independent intelligence.<br />Connected by Mycellios.</Text></div><nav aria-label="Product"><span>Product</span><Link href={AGENT}>Mycellios Agent</Link><Link href="/create">Create</Link><Link href="/network">Network</Link><Link href="/earn">Contribute</Link></nav><nav aria-label="Resources"><span>Resources</span><Link href="/docs">Documentation</Link><Link href={SOURCE}>GitHub</Link><Link href="/downloads">Downloads</Link><Link href="mailto:hello@mycellios.com">Contact</Link></nav><nav aria-label="Explore"><span>Explore</span><Link href="/spore">SPORE</Link><Link href="https://compute.tech/">Compute <ArrowUpRight size={12} /></Link><Link href="https://rakazo.com/">Rakazo <ArrowUpRight size={12} /></Link><Link href="/dashboard">Network panel</Link></nav></div><div className="home-footer-bottom"><span>© {new Date().getFullYear()} Mycellios</span><span>A little more connected.</span><Link href="#home-top">Back to top ↑</Link></div></footer>
  </main>;
}

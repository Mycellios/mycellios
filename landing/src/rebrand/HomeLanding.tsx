import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, CalendarClock, Cpu, FileText, Globe2, KeyRound, Laptop, Plug, ShieldCheck, Sparkles } from "lucide-react";
import { Card, Disclosure, DisclosureSummary, Heading, Link, Text } from "../ui/primitives";
import { MarketingHeader, MarketingFooter } from "./MarketingHeader";
import { AGENT_URL } from "./AssemblageAgent";
import { AGENT_API_KEYS_URL } from "../../../src/contracts/agent-account-links";
import { AgentHeroDemo, MicoAvatar } from "./AgentHeroDemo";
import { AgentDownloadAction } from "./AgentDownloadAction";
import { ContributionEntry } from "./ContributionEntry";
import { HomeNetworkMesh } from "./HomeNetworkMesh";
import { HomeArtwork } from "./HomeArtwork";
import { HomeLiveStats } from "./HomeLiveStats";
import { loadAfterFirstPaint } from "./deferred-agent-motion";
import "./reference-landing.css";
import "./agent-product.css";
import "./home-landing.css";

const ApiQuickStart = lazy(() => import("./ApiQuickStart"));

const TASKS = ["Plan a launch", "Summarize research", "Draft a clear brief", "Organize project notes", "Prepare a weekly wrap-up", "Compare options", "Review a document", "Turn notes into a plan", "Write a morning brief", "Outline a proposal"];

const QUESTIONS = [
  { q: "What is a Mico?", a: "A Mico is an AI agent in Mycellios Agent. Give it a goal, the context you choose to share and a model connection, then review what it prepares before anything moves forward." },
  { q: "Which models can a Mico use?", a: "Your own provider, a compatible model running on your computer, or models served by the Mycellios network. Available models depend on your setup and on network capacity." },
  { q: "What are Credits?", a: "Credits are the internal currency for using AI in Mycellios. Paid top-ups are 1 USD for 1 Credit, and you can also earn Credits for completed, verified work from a device you connect." },
  { q: "Is Spore the same as Credits?", a: "No. Spore is the official Mycellios token. Credits are separate and pay for AI usage inside Mycellios." },
  { q: "Does contributing start on its own?", a: "No. Nothing runs from this page. You start contributing with Play in the browser or the desktop app, and you can pause whenever you need." },
  { q: "Can I build with the API?", a: "Yes. Mycellios offers an OpenAI-compatible endpoint. Create a key in Agent settings, pick an available chat model and point your client at the endpoint." },
] as const;

function Kicker({ children }: { children: string }) {
  return <Text as="span" className="home-kicker">{children}</Text>;
}

const ignorePlayback = () => {};

/** Each rotating verb belongs to one Mico and takes its color. */
const VERBS = [["plan", "planning"], ["research", "research"], ["write", "writing"], ["grow", "mico"]] as const;

function useReducedMotionPreference() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function VerbRotator() {
  const [index, setIndex] = useState(0), [width, setWidth] = useState<number>();
  const word = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotionPreference();
  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => { if (!document.hidden) setIndex(value => (value + 1) % VERBS.length); }, 2400);
    return () => window.clearInterval(timer);
  }, [reduced]);
  useLayoutEffect(() => { if (word.current) setWidth(word.current.offsetWidth); }, [index]);
  const [verb, mico] = VERBS[index]!;
  return <span className="home-verb" data-mico={mico} aria-hidden="true">
    <span className="home-verb-mico" key={`m-${mico}`}><MicoAvatar name={mico} /></span>
    <span className="home-verb-slot" style={width ? { width } : undefined}><span ref={word} key={verb} className="home-verb-word">{verb}</span></span>
  </span>;
}

function HomeHero() {
  return <section className="home-hero" id="reference-content" aria-labelledby="home-title">
    <Link className="home-pill" href="/changelog"><span>New</span>See what shipped this week<ArrowRight size={13} aria-hidden="true" /></Link>
    <Heading as="h1" id="home-title" aria-label="AI agents that plan, research, write and grow with you.">
      <span className="home-hero-line" aria-hidden="true">{["AI", "agents", "that"].map((word, index) => <span key={word} className="home-word" style={{ ["--i" as string]: index }}><span>{word}</span></span>)}</span>
      <span className="home-hero-line" aria-hidden="true"><span className="home-word" style={{ ["--i" as string]: 3 }}><span><VerbRotator /></span></span><span className="home-word" style={{ ["--i" as string]: 4 }}><span>with</span></span><span className="home-word" style={{ ["--i" as string]: 5 }}><span>you.</span></span></span>
    </Heading>
    <Text className="home-hero-lede">Micos are AI agents for your ideas, projects and everyday work. They use the models you choose, including an open network of shared computers.</Text>
    <div className="agent-product-actions home-hero-actions"><AgentDownloadAction /><Link href={AGENT_URL} variant="secondary" size="xl" className="agent-product-browser"><ArrowUpRight size={16} aria-hidden="true" />Open in browser</Link></div>
    <Text as="small" className="home-hero-note">Desktop app or browser · Free to start</Text>
    <div className="home-hero-art">
      <HomeArtwork src="/assets/landing/network-fruiting.webp" width={1774} height={877} label="Concept artwork: computers joined by mycelium, with mushrooms growing from the network" />
      <Text as="small" className="home-hero-art-caption">Concept artwork · Move your cursor to see it in color</Text>
    </div>
  </section>;
}

function PeekingMico() {
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const move = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2), dy = event.clientY - (rect.top + rect.height / 2);
        const distance = Math.hypot(dx, dy) || 1, reach = Math.min(1, distance / 400);
        element.style.setProperty("--mico-look-x", `${(dx / distance) * 2.6 * reach}px`);
        element.style.setProperty("--mico-look-y", `${(dy / distance) * 2.2 * reach}px`);
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener("pointermove", move); };
  }, []);
  return <span ref={root} className="home-peek" aria-hidden="true"><MicoAvatar name="mico" /></span>;
}

function ProductStage() {
  return <section className="home-product" aria-labelledby="home-product-title" data-home-band>
    <svg className="home-dots" aria-hidden="true"><defs><pattern id="home-dot-grid" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" /></pattern></defs><rect width="100%" height="100%" fill="url(#home-dot-grid)" /></svg>
    <div className="home-shell home-product-head" data-reveal>
      <Kicker>Mycellios Agent</Kicker>
      <Heading as="h2" id="home-product-title">Meet your Micos.</Heading>
      <Text>One workspace for conversations, projects, models and tools. Give each Mico a focus and keep every decision in your hands.</Text>
    </div>
    <div className="home-stage-wrap"><div className="agent-product-stage home-stage" id="agent" data-home-stage><PeekingMico /><AgentHeroDemo onPlaybackChange={ignorePlayback} /></div></div>
  </section>;
}

const MICO_TONES = ["planning", "research", "writing", "mico"] as const;

function TaskMarquee() {
  const row = TASKS.map((task, index) => <span key={task} className="home-marquee-item" data-mico={MICO_TONES[index % MICO_TONES.length]}><i />{task}</span>);
  return <section className="home-marquee" aria-label="Examples of work for a Mico">
    <div className="home-marquee-track"><div>{row}</div><div aria-hidden="true">{row}</div></div>
  </section>;
}

function CollaborationVisual() {
  return <div className="home-viz home-viz-collab" aria-hidden="true">
    <div className="home-collab-agents">{([["research", "Research", "Source notes"], ["planning", "Planning", "Project outline"], ["writing", "Review", "Clearer brief"]] as const).map(([name, title, file], index) => <div key={name} className="home-collab-agent" style={{ ["--i" as string]: index }}><MicoAvatar name={name} /><span><strong>{title}</strong><small><FileText size={11} />{file}</small></span><Check size={14} className="home-collab-check" /></div>)}</div>
    <svg className="home-collab-lines" viewBox="0 0 80 200" preserveAspectRatio="none"><path d="M0 34 C 40 34, 40 100, 80 100" /><path d="M0 100 L 80 100" /><path d="M0 166 C 40 166, 40 100, 80 100" /></svg>
    <div className="home-collab-doc"><span className="home-collab-file"><FileText size={12} />Launch brief.md</span><strong>Less scope.<br />A clearer next step.</strong>{[0, 1, 2].map(line => <i key={line} style={{ ["--i" as string]: line }} />)}</div>
  </div>;
}

function ModelsVisual() {
  return <div className="home-viz home-viz-models" aria-hidden="true">
    <span className="home-models-highlight" />
    {([[KeyRound, "Your provider", "A connection you configure"], [Laptop, "Local model", "A compatible endpoint"], [Globe2, "Mycellios network", "Shared network capacity"]] as const).map(([Icon, title, detail]) => <div key={title} className="home-models-row"><Icon size={16} /><span><strong>{title}</strong><small>{detail}</small></span></div>)}
  </div>;
}

function RoutineVisual() {
  return <div className="home-viz home-viz-routine" aria-hidden="true">
    <div className="home-routine-head"><CalendarClock size={15} /><strong>Morning brief</strong><span>09:00</span></div>
    <div className="home-routine-days">{["Mon", "Tue", "Wed", "Thu", "Fri"].map((day, index) => <span key={day} style={{ ["--i" as string]: index }}><small>{day}</small><i /></span>)}</div>
  </div>;
}

function ApprovalVisual() {
  return <div className="home-viz home-viz-approval" aria-hidden="true">
    <div className="home-approval-card"><span className="home-approval-title"><ShieldCheck size={15} />Read README.md</span><small>Use the notes attached to this project.</small>
      <span className="home-approval-actions"><span>Deny</span><span className="home-approval-allow">Allow once</span></span>
      <span className="home-approval-done"><Check size={13} />Allowed once</span>
    </div>
    <svg className="home-approval-cursor" viewBox="0 0 24 24"><path d="M4 3l7.5 17 2.2-6.8L20.5 11z" /></svg>
  </div>;
}

function SurfacesVisual() {
  return <div className="home-viz home-viz-surfaces" aria-hidden="true">
    <div className="home-surface-window"><span className="home-surface-bar"><i /><i /><i /></span><span className="home-surface-body"><MicoAvatar name="mico" /><span><i /><i /></span></span></div>
    <div className="home-surface-window home-surface-browser"><span className="home-surface-bar"><i /><i /><i /><em>mycellios.com/agent</em></span><span className="home-surface-body"><MicoAvatar name="planning" /><span><i /><i /></span></span></div>
  </div>;
}

function FeatureBento() {
  return <section className="home-section home-shell" id="features" aria-labelledby="home-features-title">
    <div className="home-section-head" data-reveal><Kicker>Mycellios Agent</Kicker><Heading as="h2" id="home-features-title">Everything a Mico needs<br /> to do good work.</Heading><Text>Give each agent a focus, the context it needs and a model that fits. You stay in charge of every step.</Text></div>
    <div className="home-bento">
      <Card className="home-card home-card-wide" data-tone="lavender" data-reveal><CollaborationVisual /><div className="home-card-copy"><Heading as="h3">Many Micos, one direction.</Heading><Text>Research, planning and review agents work from the same project and bring their results together.</Text></div></Card>
      <Card className="home-card" data-tone="amber" data-reveal><ModelsVisual /><div className="home-card-copy"><Heading as="h3">Your model, your choice.</Heading><Text>Bring a provider, run a local model or use the network.</Text></div></Card>
      <Card className="home-card" data-tone="moss" data-reveal><ApprovalVisual /><div className="home-card-copy"><Heading as="h3">Approval comes first.</Heading><Text>Review what is shared and allow actions one at a time.</Text></div></Card>
      <Card className="home-card" data-tone="mint" data-reveal><RoutineVisual /><div className="home-card-copy"><Heading as="h3">Routines on your schedule.</Heading><Text>Give recurring work a goal and a time. Come back to a useful starting point.</Text></div></Card>
      <Card className="home-card" data-tone="rose" data-reveal><SurfacesVisual /><div className="home-card-copy"><Heading as="h3">Desktop or browser.</Heading><Text>Use the app on your computer or open Agent in any browser.</Text></div></Card>
    </div>
  </section>;
}

const MANIFESTO: ReadonlyArray<string | readonly [string, (typeof MICO_TONES)[number]]> = [
  "Mycellios", "grows", "like", "mycelium", "under", "a", "forest.", "Every", "device", "that", "joins", "adds", ["capacity,", "mico"],
  "every", "Mico", "you", "start", "puts", "it", "to", ["work,", "research"], "and", "every", "verified", "task", "earns", ["Credits", "planning"],
  "for", "the", "people", "who", ["share.", "writing"],
];

function Manifesto() {
  const sentence = MANIFESTO.map(word => typeof word === "string" ? word : word[0]).join(" ");
  return <section className="home-shell home-manifesto" aria-label="About Mycellios">
    <Text className="home-manifesto-text" aria-label={sentence} data-home-manifesto>{MANIFESTO.map((word, index) => typeof word === "string"
      ? <span key={index} aria-hidden="true">{word} </span>
      : <span key={index} aria-hidden="true" className="home-manifesto-accent" data-mico={word[1]}><MicoAvatar name={word[1]} />{word[0]} </span>)}</Text>
  </section>;
}

function GoalVisual() {
  return <div className="home-step-viz home-step-goal" aria-hidden="true">
    <div className="home-goal-input"><span className="home-goal-typed">Plan our launch for next month</span><span className="home-goal-send"><ArrowRight size={14} /></span></div>
    <div className="home-goal-reply"><MicoAvatar name="planning" /><span><strong>Here is a first plan.</strong><small>Three milestones, one owner each and a clear next step for Monday.</small></span></div>
  </div>;
}

function ContextVisual() {
  return <div className="home-step-viz home-step-context" aria-hidden="true">
    {["Launch notes.md", "Audience brief.pdf", "Budget.xlsx"].map((file, index) => <span key={file} className="home-context-file" style={{ ["--i" as string]: index }}><FileText size={14} />{file}<Check size={13} /></span>)}
    <span className="home-context-model"><Globe2 size={14} />Model connection<strong>Your choice</strong></span>
  </div>;
}

function ReviewVisual() {
  return <div className="home-step-viz home-step-review" aria-hidden="true">
    <div className="home-collab-doc"><span className="home-collab-file"><FileText size={12} />Launch plan.md</span><strong>Ready for your review.</strong>{["Shape the scope", "Build the full path", "Make room to learn"].map((item, index) => <span key={item} className="home-review-item" style={{ ["--i" as string]: index }}><Check size={13} />{item}</span>)}</div>
  </div>;
}

function HowItWorks() {
  const steps = [
    ["01", "Give it a goal", "Describe the outcome you want. A Mico turns it into a plan with a clear next step.", "lavender", GoalVisual],
    ["02", "Choose the context", "Attach notes and files and pick a model connection. Only what you share is used.", "amber", ContextVisual],
    ["03", "Review the result", "Approve actions as they come up and shape the draft before it moves forward.", "mint", ReviewVisual],
  ] as const;
  return <section className="home-section home-shell home-steps" aria-labelledby="home-steps-title">
    <div className="home-section-head" data-reveal><Kicker>How it works</Kicker><Heading as="h2" id="home-steps-title">From an idea to a plan<br /> you can act on.</Heading></div>
    <ol className="home-stack">{steps.map(([number, title, body, tone, Visual], index) => <li key={number} className="home-stack-card" data-tone={tone} data-home-stack style={{ ["--i" as string]: index }}>
      <div className="home-stack-copy"><span className="home-step-number">{number}</span><Heading as="h3">{title}</Heading><Text>{body}</Text></div>
      <Visual />
    </li>)}</ol>
  </section>;
}

function NetworkBand() {
  return <section className="home-band" id="network" aria-labelledby="home-network-title" data-home-band>
    <svg className="home-dots" aria-hidden="true"><rect width="100%" height="100%" fill="url(#home-dot-grid)" /></svg>
    <div className="home-shell home-band-inner">
      <div className="home-band-copy" data-reveal>
        <Kicker>The Mycellios network</Kicker>
        <Heading as="h2" id="home-network-title">Share your power.<br /><span>Use AI for free.</span></Heading>
        <Text>Phones, laptops, desktop PCs and servers can join one shared network. Connect a device, complete verified work and earn Credits to use with your Micos.</Text>
        <div className="home-band-actions"><Link variant="primary" size="xl" href="#join-network">Connect your device<ArrowRight size={16} aria-hidden="true" /></Link><Link className="home-band-link" href="/earn">How earning works<ArrowUpRight size={15} aria-hidden="true" /></Link></div>
      </div>
      <div className="home-band-visual" data-reveal><HomeNetworkMesh /><Text as="small">Conceptual illustration of the network vision, not live network data.</Text></div>
    </div>
    <div className="home-shell home-band-steps">{([[Plug, "Connect a device", "Start from the browser or the desktop app."], [Cpu, "Complete verified work", "Your device serves AI requests the network can verify."], [Sparkles, "Earn Credits", "Credits go to your wallet to use with your Micos."]] as const).map(([Icon, title, body]) => <div key={title} data-reveal><Icon size={18} aria-hidden="true" /><Heading as="h3">{title}</Heading><Text>{body}</Text></div>)}</div>
  </section>;
}

function DeveloperSection() {
  return <section className="home-section home-shell home-dev" id="build-api" aria-labelledby="home-dev-title">
    <div className="home-dev-copy" data-reveal>
      <Kicker>For developers</Kicker>
      <Heading as="h2" id="home-dev-title">Build with<br />the API.</Heading>
      <Text>One OpenAI-compatible endpoint. Keep your tools and clients, backed by an open compute network.</Text>
      <ol className="home-dev-steps"><li><span>1</span>Choose an available chat model in <Link href="/stats">Stats</Link>.</li><li><span>2</span>Create a key in <Link href={AGENT_API_KEYS_URL}>API keys</Link>.</li><li><span>3</span>Add the endpoint to your client and send a request.</li></ol>
      <Link className="home-band-link" href="/docs">Read the docs<ArrowUpRight size={15} aria-hidden="true" /></Link>
    </div>
    <div className="home-dev-code" data-reveal><Suspense fallback={<div className="home-dev-fallback"><Heading as="h3">Your first request</Heading><Link href="/docs">Open the API quickstart</Link></div>}><ApiQuickStart /></Suspense></div>
  </section>;
}

function Questions() {
  return <section className="home-section home-shell home-faq" id="questions" aria-labelledby="home-faq-title">
    <div className="home-section-head" data-reveal><Kicker>Questions</Kicker><Heading as="h2" id="home-faq-title">Good to know.</Heading></div>
    <div className="home-faq-list" data-reveal>{QUESTIONS.map(item => <Disclosure key={item.q} className="home-faq-item"><DisclosureSummary>{item.q}<span className="home-faq-sign" aria-hidden="true"><i /><i /></span></DisclosureSummary><div className="home-faq-answer"><Text>{item.a}</Text></div></Disclosure>)}</div>
  </section>;
}

function ClosingCta() {
  return <section className="home-shell home-cta" aria-labelledby="home-cta-title">
    <span className="home-giant" aria-hidden="true" data-home-giant>Grow with us.</span>
    <div className="home-cta-card" data-reveal>
      <div className="home-cta-micos" aria-hidden="true">{(["research", "mico", "planning", "writing"] as const).map((name, index) => <span key={name} style={{ ["--i" as string]: index }}><MicoAvatar name={name} /></span>)}</div>
      <Heading as="h2" id="home-cta-title">Start with a Mico today.</Heading>
      <Text>Download the app or open Agent in your browser. Your projects, your models, your pace.</Text>
      <div className="agent-product-actions"><AgentDownloadAction /><Link href={AGENT_URL} variant="secondary" size="xl" className="agent-product-browser"><ArrowUpRight size={16} aria-hidden="true" />Open in browser</Link></div>
    </div>
  </section>;
}

function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return scrolled;
}

export function HomeLanding() {
  const root = useRef<HTMLElement>(null);
  const scrolled = useScrolled();
  useEffect(() => { void import("../seo").then(module => module.applySeoMetadata("/")); }, []);
  useEffect(() => {
    let active = true, destroy: (() => void) | undefined;
    void loadAfterFirstPaint(() => import("./home-motion")).then(({ animateHome }) => {
      if (active && root.current) destroy = animateHome(root.current);
    }).catch(() => { /* The complete page stays visible without motion. */ });
    return () => { active = false; destroy?.(); };
  }, []);
  return <main ref={root} className="mycellios-reference home" id="reference-top" data-ambient-running="true">
    <Link className="assembly-skip" href="#reference-content">Skip to content</Link>
    <div className="home-header" data-scrolled={scrolled}><MarketingHeader /></div>
    <HomeHero />
    <ProductStage />
    <TaskMarquee />
    <HomeLiveStats />
    <Manifesto />
    <FeatureBento />
    <HowItWorks />
    <NetworkBand />
    <ContributionEntry />
    <DeveloperSection />
    <Questions />
    <ClosingCta />
    <MarketingFooter />
  </main>;
}

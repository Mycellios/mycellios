import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight } from "lucide-react";
import { Heading, Link, Text } from "../ui/primitives";
import { MarketingHeader as ReferenceHeader, MarketingFooter as ReferenceFooter } from "./MarketingHeader";
export { ReferenceHeader };
import { applySeoMetadata } from "../seo";
import { AGENT_URL, AssemblageAgent } from "./AssemblageAgent";
import { NetworkPrint, type NetworkArtwork } from "./NetworkPrint";
import { ForestIntroControl } from "./ForestIntroControl";
import { AgentProductHero } from "./AgentProductHero";
import { AgentUseCasesEntry } from "./AgentUseCasesEntry";
import { AgentNetworkThread } from "./AgentNetworkThread";
import { AgentClosing } from "./AgentClosing";
import "./assemblage-landing.css";
import "./reference-landing.css";
import "./agent-product.css";
import "./agent-journey.css";

const ApiQuickStart = lazy(() => import("./ApiQuickStart"));
const LegacyLowerContent = lazy(() => import("./AgentLowerContent"));
const ComparePreview = lazy(() => import("./ComparePreview"));

function NetworkStory({ artwork }: { artwork: NetworkArtwork }) {
  return <div className="reference-network-story" id="network"><div className="reference-world-visual" role="img" aria-label={artwork === "fruiting" ? "Conceptual computing fabric with mushrooms growing from branching mycelium" : "Conceptual computing fabric: four computer modules connected by branching mycelium"}><NetworkPrint artwork={artwork} /></div><section className="reference-network-chapter reference-shell" id="build-api" aria-labelledby="reference-network-title"><div className="reference-network-copy"><Heading as="h2" id="reference-network-title">Build with<br />the API.</Heading><Text>One OpenAI-compatible endpoint. Your tools, backed by an open compute network.</Text><ol className="reference-api-steps"><li>Choose an available chat model in <Link href="/dashboard#models">Stats</Link>.</li><li>Set up your API credentials in the <Link href="/dashboard?view=overview">console</Link>.</li><li>Add the endpoint to your client and send a request.</li></ol><Link className="reference-status-link" href="/docs">Start building<ArrowUpRight size={14} /></Link></div><Suspense fallback={<div><Heading as="h3">Your first request</Heading><Link href="/docs">Open the API quickstart</Link></div>}><ApiQuickStart /></Suspense></section><div className="reference-world-caption reference-shell"><span>Computing fabric concept. The network vision includes personal devices and servers.</span></div></div>;
}

export function ReferenceLanding({ initialArtwork, networkOpening = false }: { initialArtwork?: NetworkArtwork; networkOpening?: boolean } = {}) {
  const [journeyRunning, setJourneyRunning] = useState(true);
  const artwork = initialArtwork ?? (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("art") === "fabric" ? "fabric" : "fruiting");
  const showNetworkOpening = networkOpening || (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("intro") === "forest");
  useEffect(() => { applySeoMetadata("/"); }, []);
  return <main className="mycellios-assemblage mycellios-reference" id="reference-top" data-journey-running={journeyRunning}><ForestIntroControl /><Link className="assembly-skip" href="#reference-content">Skip to content</Link>{showNetworkOpening ? <><ReferenceHeader />
    <section className="reference-hero reference-shell" id="reference-content" aria-labelledby="reference-title"><Heading as="h1" id="reference-title">Many machines. <br />One shared network.</Heading><Text>Open infrastructure for distributed AI. <br />Work with Agent, build with the API, or bring your compute.</Text><div className="reference-hero-actions"><Link href="#network" variant="primary" size="xl">How it works<ArrowDown size={17} aria-hidden="true" /></Link></div></section></> : <AgentProductHero header={<ReferenceHeader />} onPlaybackChange={setJourneyRunning} />}
    {showNetworkOpening ? <NetworkStory artwork={artwork} /> : <div className="agent-journey-body"><AgentNetworkThread /><AgentUseCasesEntry /><Suspense fallback={<section className="reference-shell"><Link href="/compare">Compare agent apps</Link></section>}><ComparePreview /></Suspense><NetworkStory artwork={artwork} /></div>}
    {showNetworkOpening && <section className="reference-agent reference-shell" id="agent" aria-labelledby="reference-agent-title"><Heading as="h2" id="reference-agent-title">Meet Mycellios Agent.</Heading><Text>Conversations, models and tools in one workspace.</Text><Link variant="primary" size="xl" href={AGENT_URL}>Open Mycellios Agent<ArrowRight size={17} /></Link><AssemblageAgent expanded /></section>}
    {showNetworkOpening ? <><Suspense fallback={null}><LegacyLowerContent /></Suspense><ReferenceFooter /></> : <AgentClosing footer={<ReferenceFooter />} />}
  </main>;
}

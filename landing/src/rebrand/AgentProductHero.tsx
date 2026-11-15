import { loadAgentMotion } from "./deferred-agent-motion";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { Button, Heading, Link, Text } from "../ui/primitives";
import { AGENT_URL } from "./AssemblageAgent";
import { AgentHeroDemo, MicoAvatar } from "./AgentHeroDemo";
import { AgentHeroBackdrop } from "./AgentHeroBackdrop";
import { AgentDownloadAction } from "./AgentDownloadAction";
import { GoldenMycelium } from "./GoldenMycelium";

export function AgentProductHero({ header, onPlaybackChange }: { header: ReactNode; onPlaybackChange?: (playing: boolean) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [ambientPaused, setAmbientPaused] = useState(false), [inView, setInView] = useState(false);
  const playbackChange = useCallback((playing: boolean) => { setAmbientPaused(!playing); onPlaybackChange?.(playing); }, [onPlaybackChange]);
  useEffect(() => {
    if (!root.current) return;
    const observer = new IntersectionObserver(entries => setInView(entries[0]?.isIntersecting ?? false));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true, destroy: (() => void) | undefined;
    void loadAgentMotion().then(({ animateAgentHero }) => {
      if (active && root.current) destroy = animateAgentHero(root.current);
    }).catch(() => { /* The complete hero remains visible if motion cannot load. */ });
    return () => { active = false; destroy?.(); };
  }, []);
  return <div ref={root} className="agent-product-opening" data-ui-surface="agent-marketing" data-ambient-running={!ambientPaused && inView}>
    <AgentHeroBackdrop />
    <GoldenMycelium running={!ambientPaused && inView} />
    {header}
    <section className="agent-product-hero" id="reference-content" aria-labelledby="reference-title">
      <Heading as="h1" id="reference-title" aria-label="Meet Mycellios" data-hero-enter><span>Meet <Button variant="ghost" className="agent-mico-greeting" aria-label="Say hello to Mico"><MicoAvatar /></Button></span> Mycellios</Heading>
      <Text data-hero-enter>AI agents for your ideas, projects and everyday work.</Text>
      <div className="agent-product-actions" data-hero-enter><AgentDownloadAction /><Link href={AGENT_URL} variant="secondary" size="xl" className="agent-product-browser"><ArrowUpRight size={16} aria-hidden="true" />Open in browser</Link></div>
      <div className="agent-product-earn" data-hero-enter>
        <Link href="#join-network" className="agent-product-earn-link"><span>Share power.</span> <span>Earn Credits.</span> <span>Use AI.</span><ArrowUpRight size={13} aria-hidden="true" /></Link>
        <Text>Share spare power with our distributed network. Earn Credits for completed, verified work to use AI without paying.</Text>
      </div>
      <div className="agent-product-stage" id="agent" data-hero-window><AgentHeroDemo onPlaybackChange={playbackChange} /></div>
    </section>
  </div>;
}

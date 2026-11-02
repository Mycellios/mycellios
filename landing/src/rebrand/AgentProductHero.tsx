import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Download, Link2, ShieldCheck } from "lucide-react";
import { Button, Heading, Link, Text } from "../ui/primitives";
import { AGENT_URL } from "./AssemblageAgent";
import { AgentHeroDemo, MicoAvatar } from "./AgentHeroDemo";
import { AgentHeroBackdrop } from "./AgentHeroBackdrop";

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
    void import("./agent-hero-motion").then(({ animateAgentHero }) => {
      if (active && root.current) destroy = animateAgentHero(root.current);
    }).catch(() => { /* The complete hero remains visible if motion cannot load. */ });
    return () => { active = false; destroy?.(); };
  }, []);
  return <div ref={root} className="agent-product-opening" data-ui-surface="agent-marketing" data-ambient-running={!ambientPaused && inView}>
    <AgentHeroBackdrop />
    {header}
    <section className="agent-product-hero" id="reference-content" aria-labelledby="reference-title">
      <Heading as="h1" id="reference-title" aria-label="Meet Mycellios" data-hero-enter><span>Meet <Button variant="ghost" className="agent-mico-greeting" aria-label="Say hello to Mico"><MicoAvatar /></Button></span> Mycellios</Heading>
      <Text data-hero-enter>AI agents for the work ahead. Bring your ideas, connect your models, and grow a workspace that works with you.</Text>
      <div className="agent-product-actions" data-hero-enter><Link href="/downloads/desktop" variant="primary"><Download size={16} aria-hidden="true" />Download for desktop</Link><Link href={AGENT_URL} variant="secondary"><ArrowUpRight size={15} aria-hidden="true" />Open in browser</Link></div>
      <div className="agent-product-stage" data-hero-window><AgentHeroDemo onPlaybackChange={playbackChange} /></div>
    </section>
    <section className="agent-product-benefits" id="agent" aria-label="Work with Mycellios"><Link href={AGENT_URL}><ShieldCheck size={42} aria-hidden="true" /><span><Heading as="h2">Create Micos</Heading><Text>Build focused agents for your projects, ideas and teams.</Text></span></Link><Link href={AGENT_URL}><Link2 size={42} aria-hidden="true" /><span><Heading as="h2">Connect models</Heading><Text>Choose a supported model connection for your work.</Text></span></Link><Link href="#contribute"><img src="/assets/brand/favicon.png" width="42" height="42" alt="" /><span><Heading as="h2">Share compute</Heading><Text>Connect a compatible device and choose how it contributes.</Text></span></Link></section>
  </div>;
}

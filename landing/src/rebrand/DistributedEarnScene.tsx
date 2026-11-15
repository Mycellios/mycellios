import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, CircleDollarSign, Cpu, Monitor, Pause, Play, Smartphone } from "lucide-react";
import { Heading, IconButton, Link, Text } from "../ui/primitives";
import { MicoAvatar } from "./AgentHeroDemo";
import { distributedEarnArtwork } from "./distributed-earn-model";
import "./distributed-earn-scene.css";

const artwork = distributedEarnArtwork();
const avatars = ["mico", "planning", "research", "writing"] as const;
const devices = [Monitor, Smartphone, Cpu] as const;

export function DistributedEarnScene({ running = true }: { running?: boolean }) {
  const root = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false), [hidden, setHidden] = useState(false), [paused, setPaused] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false));
    const mesh = root.current?.querySelector(".distributed-earn-mesh");
    if (mesh) observer.observe(mesh);
    const visibility = () => setHidden(document.hidden);
    visibility(); document.addEventListener("visibilitychange", visibility);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  const active = running && visible && !hidden && !paused;
  return <section ref={root} id="distributed-ai" className="distributed-earn-scene" aria-labelledby="distributed-earn-title" data-ambient-running={active}>
    <div className="distributed-earn-intro reference-shell">
      <Heading as="h2" id="distributed-earn-title">Share your power.<br /><span>Use AI for free.</span></Heading>
      <Text>Connect your device to a distributed AI network. Earn Credits for completed, verified inference, then use them with your Micos.</Text>
      <Link href="#join-network" className="distributed-earn-connect">Connect your device<ArrowUpRight size={16} aria-hidden="true" /></Link>
    </div>
    <figure className="distributed-earn-art" aria-label="Illustration of a distributed peer network: Micos, computers and phones connected by mycelium, with symbols representing AI Credits">
      <div className="distributed-earn-mesh" aria-hidden="true">
        <svg className="distributed-earn-edges" viewBox="0 0 1200 560" preserveAspectRatio="none">
          {artwork.edges.map((edge, index) => <path key={edge.id} d={edge.path} data-mobile={edge.mobile} data-credit={index % 7 === 0} style={{ "--edge-delay": `${index % 8 * -.7}s` } as CSSProperties} />)}
        </svg>
        {artwork.nodes.map(node => {
          const Device = devices[node.id % devices.length]!;
          const credit = node.id % 6 === 2;
          return <span key={node.id} className="distributed-earn-node" data-mobile={node.mobile} style={{ left: `${node.x / 12}%`, top: `${node.y / 5.6}%`, "--node-size": `${34 + node.id % 4 * 6}px`, "--coin-delay": `${node.id % 5 * -.8}s` } as CSSProperties}>
            <MicoAvatar name={avatars[node.id % avatars.length]!} />
            {credit ? <span className="distributed-earn-credit"><CircleDollarSign size={18} /></span> : <span className="distributed-earn-device"><Device size={13} /></span>}
          </span>;
        })}
      </div>
      <figcaption className="reference-shell"><span>Network illustration · Credits are earned from verified work. Availability depends on your device and network demand.</span><IconButton className="distributed-earn-motion" variant="ghost" disabled={!running} aria-label={paused ? "Play network animation" : "Pause network animation"} aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? <Play size={15} /> : <Pause size={15} />}</IconButton></figcaption>
    </figure>
  </section>;
}

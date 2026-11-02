import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Heading, Link, Text } from "../ui/primitives";
import { MARKETING_AGENT_URL } from "./MarketingHeader";
import { MicoAvatar } from "./AgentHeroDemo";
import AgentLowerContent from "./AgentLowerContent";
import AgentClosingScene from "./AgentClosingScene";

export default function AgentClosingContent({ tail }: { tail: HTMLElement }) {
  const section = useRef<HTMLElement>(null), [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return <><AgentLowerContent /><section ref={section} className="agent-closing" aria-labelledby="agent-closing-title" data-ui-surface="agent-marketing"><div className="agent-closing-emblem" aria-hidden="true"><MicoAvatar /></div><div className="agent-closing-copy"><Heading as="h2" id="agent-closing-title">Grow your first Mico.</Heading><Text>Bring an idea. Give it context. Grow from there.</Text><Link href={MARKETING_AGENT_URL} variant="primary">Open Mycellios Agent<ArrowUpRight size={16} aria-hidden="true" /></Link></div></section>{mounted && <AgentClosingScene section={section.current!} tail={tail} />}</>;
}

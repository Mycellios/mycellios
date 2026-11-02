import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Heading, Link, Text } from "../ui/primitives";
import { AGENT_URL } from "./AssemblageAgent";

const AgentUseCases = lazy(() => import("./AgentUseCases").catch(() => ({ default: CaseFallback })));

function CaseFallback() {
  return <section className="agent-use-cases agent-case-fallback reference-shell" aria-label="Example workflows"><div><Heading as="h2">A Mico for<br />what’s next.</Heading><Text>Plan a project, research an idea or write a clearer brief.</Text><Link href={AGENT_URL}>Open Mycellios Agent</Link></div></section>;
}

/** Defer below-the-fold examples while preserving their space and a usable fallback. */
export function AgentUseCasesEntry() {
  const root = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!root.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setReady(true); observer.disconnect(); }
    }, { rootMargin: "180px" });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={root}>{ready ? <Suspense fallback={<CaseFallback />}><AgentUseCases /></Suspense> : <CaseFallback />}</div>;
}

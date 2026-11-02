import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Heading, Link, Text } from "../ui/primitives";
import "./agent-closing.css";

const ClosingContent = lazy(() => import("./AgentClosingContent").catch(() => ({ default: ClosingFallback })));

function ClosingFallback() {
  return <div className="agent-tail-loading"><section className="reference-contribute reference-shell" id="contribute"><div><Heading as="h2">Make your GPU count.</Heading><Text>Choose how you contribute to the network.</Text><Link href="/earn">Explore contribution options</Link></div></section></div>;
}

export function AgentClosing({ footer }: { footer: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!root.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setReady(true); observer.disconnect(); }
    }, { rootMargin: "600px" });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={root} className="agent-rooted-tail">
    {ready ? <Suspense fallback={<ClosingFallback />}><ClosingContent tail={root.current!} /></Suspense> : <ClosingFallback />}
    {footer}
  </div>;
}

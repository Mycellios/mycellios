import { useEffect, useRef } from "react";

export function AgentNetworkThread() {
  const root = useRef<SVGSVGElement>(null);
  useEffect(() => {
    let active = true, destroy: (() => void) | undefined;
    void import("./agent-hero-motion").then(({ animateNetworkThread }) => {
      if (active && root.current) destroy = animateNetworkThread(root.current);
    }).catch(() => {});
    return () => { active = false; destroy?.(); };
  }, []);
  const path = "M69 0C65 95 15 108 28 205S68 325 43 410S12 520 31 610S72 738 45 820S15 935 38 1040S57 1190 43 1280S25 1440 60 1600";
  return <svg className="agent-journey-thread" ref={root} viewBox="0 0 80 1600" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path className="agent-thread-root" d={path} vectorEffect="non-scaling-stroke" />
    <path className="agent-thread-branches" d="M69 0C4 50 5 160 28 205M28 205C5 240 6 375 43 410M43 410C76 445 72 575 31 610M31 610C4 655 5 775 45 820M45 820C76 865 72 990 38 1040M38 1040C4 1085 5 1235 43 1280M43 1280C76 1340 75 1525 60 1600" vectorEffect="non-scaling-stroke" />
    <path className="agent-thread-progress" d={path} strokeDasharray="0 100000" vectorEffect="non-scaling-stroke" />
    <g className="agent-thread-light" opacity="0"><circle r="8" className="agent-thread-halo" /><circle r="3.5" /><circle r="1.3" fill="#fff" /></g>
  </svg>;
}

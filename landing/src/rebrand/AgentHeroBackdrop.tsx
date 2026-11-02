import type { CSSProperties } from "react";

// Registered to the illustration's 1774 × 887 coordinate space.
const routes = [
  "M66 458C129 428 191 412 246 406S324 392 375 355S398 237 365 172",
  "M330 242C349 194 381 159 426 139S508 129 559 166S632 233 690 248",
  "M48 795C117 780 176 770 231 742S300 653 362 641S459 649 533 674",
  "M248 732C425 772 521 792 675 802S956 868 1104 797S1317 740 1475 735",
  "M1686 775C1628 738 1570 679 1552 615S1498 526 1489 454S1508 347 1556 297",
  "M1737 488C1661 490 1592 474 1542 439S1451 384 1392 392S1286 443 1203 457",
] as const;
const wideSpores = [[82,174],[304,210],[64,468],[294,550],[86,786],[205,1040],[1368,154],[1154,276],[1398,460],[1176,636],[1380,842],[1258,1070]];
const compactSpores = [[24,114],[48,312],[10,406],[34,692],[12,958],[366,132],[342,332],[380,412],[358,720],[378,980]];

function FloatingSpores({ spores, compact = false }: { spores: number[][]; compact?: boolean }) {
  return <svg className={`agent-backdrop-art ${compact ? "agent-backdrop-compact" : "agent-backdrop-wide"}`} viewBox={compact ? "0 0 390 1100" : "0 0 1440 1250"} preserveAspectRatio="none" focusable="false">
    <g className="agent-backdrop-spores">{spores.map(([cx,cy],index) => <circle key={index} cx={cx} cy={cy} r="1" vectorEffect="non-scaling-stroke" style={{ "--spore-index": index } as CSSProperties} />)}</g>
  </svg>;
}

/** The artwork and signals breathe together without reacting to pointer movement. */
export function AgentHeroBackdrop() {
  return <div className="agent-product-backdrop" aria-hidden="true">
    <div className="agent-living-network"><div className="agent-network-depth"><div className="agent-network-breath">
      <img src="/assets/agent-demo/living-network-v1.webp" width="1774" height="887" alt="" decoding="async" fetchPriority="low" />
      <svg className="agent-network-signals" viewBox="0 0 1774 887" preserveAspectRatio="none" focusable="false">
        {routes.map((d, index) => <g key={d} className="agent-signal-route" data-tone={index % 2 ? "gold" : "moss"}>
          <path className="agent-signal-path" d={d} strokeDasharray="0 100000" vectorEffect="non-scaling-stroke" />
          {[0, 1].map(pulse => <g key={pulse} className="agent-signal-point" opacity="0">
            <circle className="agent-signal-halo" r="9" />
            <circle className="agent-signal-core" r="3.4" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
            <circle className="agent-signal-center" r="1.25" />
          </g>)}
        </g>)}
      </svg>
    </div></div></div>
    <div className="agent-spore-depth"><FloatingSpores spores={wideSpores} /><FloatingSpores spores={compactSpores} compact /></div>
  </div>;
}

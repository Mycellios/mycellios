import { productBrand } from "@rakazo/contracts";
import { appPath } from "../lib/app-path";

export function MycelliosWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span role="img" className="inline-flex items-center gap-2.5" aria-label={productBrand.name}>
      <img
        src={appPath(productBrand.markPath)}
        alt=""
        width={26}
        height={26}
        className="size-[26px] rounded-full object-contain"
      />
      {!compact && (
        <span className="flex items-baseline gap-2">
          <span className="font-display text-[23px] font-medium tracking-[-0.025em]">Mycellios</span>
          <span className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
            Agent
          </span>
        </span>
      )}
    </span>
  );
}

export function Mico({ size = 160, className = "" }: { size?: number; className?: string }) {
  return (
    <picture className="contents">
      <source
        srcSet={appPath(productBrand.mascotAnimationPath)}
        type="image/webp"
        media="(prefers-reduced-motion: no-preference)"
      />
      <img
        src={appPath(productBrand.mascotPath)}
        alt={productBrand.companionName}
        width={size}
        height={size}
        draggable={false}
        className={`select-none object-contain ${className}`}
      />
    </picture>
  );
}

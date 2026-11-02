import { Disclosure as UiDisclosure, DisclosureSummary as UiDisclosureSummary, Link as UiLink } from "../ui/primitives";
import { ChevronDown } from "lucide-react";
import "./spore-menu.css";

export function SporeMenu({ active = false, label = "$ SPORE", rewardsLabel = "Rewards", menuLabel = "Open SPORE menu" }: { active?: boolean; label?: string; rewardsLabel?: string; menuLabel?: string }) {
  return <UiDisclosure className={`spore-menu${active ? " active" : ""}`}>
    <UiDisclosureSummary aria-label={menuLabel}><span>{label}</span><ChevronDown /></UiDisclosureSummary>
    <div className="spore-menu-popover">
      <UiLink href="/spore">Staking</UiLink>
      <UiLink href="/spore/rewards">{rewardsLabel}</UiLink>

    </div>
  </UiDisclosure>;
}

export function SporeMobileLinks({ active = false }: { active?: boolean }) {
  return <div className={`spore-mobile-links${active ? " active" : ""}`}>
    <strong>$ SPORE</strong>
    <UiLink href="/spore">Staking</UiLink><UiLink href="/spore/rewards">Rewards</UiLink>
  </div>;
}

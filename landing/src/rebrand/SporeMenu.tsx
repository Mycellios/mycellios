import { Disclosure as UiDisclosure, DisclosureSummary as UiDisclosureSummary, Link as UiLink } from "../ui/primitives";
import { ChevronDown } from "lucide-react";
import "./spore-menu.css";

export function SporeMenu({ active = false }: { active?: boolean }) {
  return <UiDisclosure className={`spore-menu${active ? " active" : ""}`}>
    <UiDisclosureSummary aria-label="Open SPORE menu"><span>$ SPORE</span><ChevronDown /></UiDisclosureSummary>
    <div className="spore-menu-popover">
      <UiLink href="/spore">Staking</UiLink>
      <UiLink href="/spore/treasury">Treasury</UiLink>
      <UiLink href="/spore/data">Data</UiLink>
    </div>
  </UiDisclosure>;
}

export function SporeMobileLinks({ active = false }: { active?: boolean }) {
  return <div className={`spore-mobile-links${active ? " active" : ""}`}>
    <strong>$ SPORE</strong>
    <UiLink href="/spore">Staking</UiLink><UiLink href="/spore/treasury">Treasury</UiLink><UiLink href="/spore/data">Data</UiLink>
  </div>;
}

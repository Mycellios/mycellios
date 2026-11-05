import { Button as UiButton, Card as UiCard, Heading as UiHeading, Text as UiText } from "../ui/primitives";
import { Leaf, LockKeyhole, Sprout } from "lucide-react";
import { MarketingHeader as LandingHeader } from "./MarketingHeader";
import "./create-studio.css";
import "./spore-studio.css";
import { RewardsPage } from "./RewardsPage";

const steps = [
  ["01", "Commit", "Choose an amount only after the SPORE ledger and custody contracts are live."],
  ["02", "Mature", "A future activation window can separate new deposits from established participation."],
  ["03", "Verify work", "Rewards must come from paid, verifiable compute—not raw usage or circular activity."],
  ["04", "Claim or compound", "Claiming and compounding remain disabled until custody, accounting and audits are complete."],
] as const;

function PreviewNotice() {
  return <aside className="spore-notice"><Sprout /><div><strong>SPORE — Coming soon</strong><span>Token issuance, staking and contributor rewards are coming soon. Terms will be published before activation.</span></div></aside>;
}

function Staking() {
  return <><section className="spore-hero"><div><span>NETWORK PARTICIPATION</span><UiHeading as="h1">Grow with <em>$SPORE</em></UiHeading><UiText>A proposed self-custody participation layer for useful, verified compute. Designed to reward real work—not speculative activity.</UiText></div><div className="spore-mark" aria-hidden="true"><i /><i /><i /><Leaf /></div></section><PreviewNotice />
    <section className="spore-gate"><LockKeyhole /><UiHeading as="h2">Staking — Coming soon</UiHeading><UiText>The interface will open only after the contract, custody model, reward source and legal gates are independently verified.</UiText><UiButton type="button" disabled>Coming soon</UiButton></section>
    <section className="spore-how"><span>PROPOSED FLOW</span><div>{steps.map(([id,title,copy]) => <UiCard key={id}><b>{id}</b><UiHeading as="h3">{title}</UiHeading><UiText>{copy}</UiText></UiCard>)}</div></section></>;
}

export function SporeStudio() {
  if (window.location.pathname.endsWith("/rewards")) return <RewardsPage />;
  return <><LandingHeader /><main className="rb-page spore-page"><div className="spore-shell"><Staking /></div></main></>;
}

import { Button as UiButton, Card as UiCard, Heading as UiHeading, Link as UiLink, Text as UiText } from "../ui/primitives";
import { Activity, Database, Leaf, LockKeyhole, Network, ShieldCheck, Sprout } from "lucide-react";
import { LandingHeader } from "./RebrandLanding";
import "./create-studio.css";
import "./spore-studio.css";

const steps = [
  ["01", "Commit", "Choose an amount only after the SPORE ledger and custody contracts are live."],
  ["02", "Mature", "A future activation window can separate new deposits from established participation."],
  ["03", "Verify work", "Rewards must come from paid, verifiable compute—not raw usage or circular activity."],
  ["04", "Claim or compound", "Claiming and compounding remain disabled until custody, accounting and audits are complete."],
] as const;

function PreviewNotice() {
  return <aside className="spore-notice"><Sprout /><div><strong>SPORE is a product preview</strong><span>No token, staking contract, treasury, price feed or reward program is live.</span></div></aside>;
}

function Staking() {
  return <><section className="spore-hero"><div><span>NETWORK PARTICIPATION</span><UiHeading as="h1">Grow with <em>$SPORE</em></UiHeading><UiText>A proposed self-custody participation layer for useful, verified compute. Designed to reward real work—not speculative activity.</UiText></div><div className="spore-mark" aria-hidden="true"><i /><i /><i /><Leaf /></div></section><PreviewNotice />
    <section className="spore-gate"><LockKeyhole /><UiHeading as="h2">Staking is not active</UiHeading><UiText>The interface will open only after the contract, custody model, reward source and legal gates are independently verified.</UiText><UiButton type="button" disabled>Connect wallet — unavailable</UiButton></section>
    <section className="spore-how"><span>PROPOSED FLOW</span><div>{steps.map(([id,title,copy]) => <UiCard key={id}><b>{id}</b><UiHeading as="h3">{title}</UiHeading><UiText>{copy}</UiText></UiCard>)}</div></section></>;
}

function FlowLine({ tone = "bronze" }: { tone?: "bronze" | "green" | "cream" }) {
  return <svg className={`spore-chart ${tone}`} viewBox="0 0 500 150" preserveAspectRatio="none" aria-hidden="true"><path d="M4 135 C54 128 63 105 102 110 S150 76 193 84 S252 48 300 61 S370 30 420 42 S463 18 496 24" /><path className="fill" d="M4 135 C54 128 63 105 102 110 S150 76 193 84 S252 48 300 61 S370 30 420 42 S463 18 496 24 L496 150 L4 150Z" /></svg>;
}

function EmptyChart() {
  return <div className="spore-empty-chart" role="img" aria-label="No verified series available"><span>AWAITING VERIFIED DATA</span></div>;
}

function Treasury() {
  return <><section className="spore-title"><span>VALUE ROUTING</span><UiHeading as="h1">The <em>SPORE</em>{" "}treasury</UiHeading><UiText>A transparent proposal for routing margin from completed compute. Nothing moves until real revenue, governance and audit trails exist.</UiText></section><PreviewNotice />
    <section className="spore-split"><UiHeading as="h2">A proposed ledger routes verified compute margin through explicit rules.</UiHeading><div><UiCard><Sprout /><strong>Network resilience</strong><UiText>Funds future worker incentives, reliability and operating reserves.</UiText></UiCard><UiCard><ShieldCheck /><strong>Participant distribution</strong><UiText>Only paid, attributable work can become a distribution event.</UiText></UiCard></div></section>
    <section className="spore-metrics"><UiCard className="primary"><span>RESERVE STATUS</span><strong>Not funded</strong><small>No treasury contract deployed</small></UiCard><UiCard><span>DISTRIBUTIONS</span><strong>0</strong><small>No reward events recorded</small></UiCard><UiCard><span>BUYBACKS</span><strong>Disabled</strong><small>No market operation configured</small></UiCard></section>
    <section className="spore-chart-grid"><UiCard><header><span>Illustrative reserve path</span><strong>Requires real revenue</strong></header><FlowLine tone="green" /></UiCard><UiCard><header><span>Illustrative distributions</span><strong>Requires verified work</strong></header><FlowLine tone="cream" /></UiCard></section></>;
}

function Data() {
  const signals = [["Credited workers", "No source"],["Credited GPU work", "No source"],["Credited browser work", "No source"],["Verified routes", "No source"],["Rewards today", "—"],["SPORE price", "Not listed"]];
  return <><section className="spore-data-hero"><div><span>MYCELLIOS / DATA</span><UiHeading as="h1">Network signals,<br/>{" "}<em>without invented numbers.</em></UiHeading><UiText>This preview shows the planned telemetry layout. For current connected nodes, models and jobs, visit the <UiLink href="/network">live network</UiLink>.</UiText></div><div className="spore-pulse" aria-hidden="true">{Array.from({length:18},(_,i)=><i key={i}/>)}</div></section><PreviewNotice />
    <section className="spore-live"><header><Activity /><UiHeading as="h2">Planned feed</UiHeading><span>source not connected</span></header><div className="spore-signal-grid">{signals.map(([label,value])=><UiCard key={label}><strong>{value}</strong><span><i />{label}</span></UiCard>)}</div></section>
    <section className="spore-telemetry"><UiHeading as="h2"><Network /> Planned contribution feed</UiHeading><div className="spore-chart-grid"><UiCard><header><span>Verified work credited per day</span><strong>Awaiting source</strong></header><EmptyChart /></UiCard><UiCard><header><span>Useful compute recorded</span><strong>Awaiting source</strong></header><EmptyChart /></UiCard></div></section>
    <section className="spore-provenance"><Database /><div><strong>Source before spectacle</strong><UiText>Every published metric will include its origin, sample window and last update. Price and market-cap panels stay absent until a real market exists.</UiText></div></section></>;
}

export function SporeStudio() {
  const path = window.location.pathname;
  return <main className="rb-page spore-page"><LandingHeader /><div className="spore-shell">{path.endsWith("/treasury") ? <Treasury /> : path.endsWith("/data") ? <Data /> : <Staking />}</div></main>;
}

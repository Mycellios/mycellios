import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Copy, Globe2, Monitor, Terminal } from "lucide-react";
import { Button, Disclosure, DisclosureSummary, Heading, Link, Text } from "../ui/primitives";
import { AGENT_URL } from "./AssemblageAgent";
import "./contribution-entry.css";

const paths = {
  browser: {
    title: "One tab. You're in.",
    description: "Your browser can be part of the network. No installation or provider keys.",
    steps: ["Open Mycellios in your browser.", "Sign in so work can reach your wallet.", "Press Play next to Generate AI."],
    href: AGENT_URL, action: "Connect in browser",
  },
  desktop: {
    title: "Put your computer to work.",
    description: "Contribute from the Mycellios app. You choose when to start and when to pause.",
    steps: ["Download the app for your computer.", "Sign in with your Mycellios account.", "Press Play next to Generate AI."],
    href: "/downloads/desktop", action: "Get the desktop app",
  },
} as const;

/** Stable public routes resolve to the published native installer, not a pinned release. */
export const contributionInstallers = {
  windows: { label: "Windows", shell: "PowerShell", note: "Windows 10+ · x64", command: "curl.exe -fL https://www.mycellios.com/downloads/windows -o mycellios-node.msi" },
  mac: { label: "macOS", shell: "Terminal", note: "macOS 13+ · Apple silicon", command: "curl -fL https://www.mycellios.com/downloads/macos-arm64 -o mycellios-node.pkg" },
} as const;

/** Uses the existing account-bound worker; this page never starts compute. */
export function ContributionEntry() {
  const [mode, setMode] = useState<keyof typeof paths>("browser");
  const [platform, setPlatform] = useState<keyof typeof contributionInstallers>("windows");
  const [copyStatus, setCopyStatus] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const path = paths[mode], installer = contributionInstallers[platform];
  async function copyCommand() {
    window.clearTimeout(timer.current);
    try { await navigator.clipboard.writeText(installer.command); setCopyStatus("Command copied"); }
    catch { setCopyStatus("Select the command and copy it manually."); }
    timer.current = window.setTimeout(() => setCopyStatus(""), 4000);
  }
  return <section className="reference-shell contribution-entry" id="join-network" aria-labelledby="contribution-entry-title">
    <div className="contribution-entry-copy">
      <Heading as="h2" id="contribution-entry-title">Your power.<br />A bigger network.</Heading>
      <Text>Share spare computing power. Earn Credits for completed, verified inference.</Text>
      <figure className="contribution-entry-visual">
        <img src="/assets/agent-demo/living-network-v1.webp" alt="An illustration of devices connected through a growing mycelium network" loading="lazy" width="1774" height="887" />
        <figcaption><span>Your device</span><ArrowRight size={15} aria-hidden="true" /><span>Verified work</span><ArrowRight size={15} aria-hidden="true" /><span>Your Credits</span></figcaption>
      </figure>
      <Text className="contribution-entry-note">Credits go to your Mycellios wallet. Work depends on device compatibility and network demand.</Text>
      <Link className="contribution-entry-learn" href="/earn">How earning works<ArrowUpRight size={16} aria-hidden="true" /></Link>
    </div>
    <div className="contribution-entry-setup" data-ui="contribution-setup">
      <div className="contribution-entry-modes" role="group" aria-label="Choose how to contribute">
        <Button variant="ghost" aria-pressed={mode === "browser"} onClick={() => setMode("browser")}><Globe2 size={16} aria-hidden="true" />Browser</Button>
        <Button variant="ghost" aria-pressed={mode === "desktop"} onClick={() => setMode("desktop")}><Monitor size={16} aria-hidden="true" />Desktop app</Button>
      </div>
      <div className="contribution-entry-instructions" aria-live="polite" aria-atomic="true">
        <Heading as="h3">{path.title}</Heading><Text>{path.description}</Text>
      </div>
      <Link className="contribution-entry-connect" variant="primary" size="xl" href={path.href}>{path.action}<ArrowUpRight size={17} aria-hidden="true" /></Link>
      <Disclosure className="contribution-entry-steps">
        <DisclosureSummary>How to connect<ChevronDown size={15} aria-hidden="true" /></DisclosureSummary>
        <ol>{path.steps.map(step => <li key={step}>{step}</li>)}</ol>
      </Disclosure>
      <Text as="small" className="contribution-entry-consent">Start with Play. Pause whenever you need. Nothing runs from this page.</Text>
      <div className="contribution-terminal">
        <header><span><Terminal size={16} aria-hidden="true" />Prefer the terminal?</span><span>Native node</span></header>
        <div className="contribution-terminal-platforms" role="group" aria-label="Native node platform">
          {(Object.keys(contributionInstallers) as Array<keyof typeof contributionInstallers>).map(value => <Button key={value} variant="ghost" aria-pressed={platform === value} onClick={() => { window.clearTimeout(timer.current); setPlatform(value); setCopyStatus(""); }}>{contributionInstallers[value].label}</Button>)}
        </div>
        <div className="contribution-terminal-code">
          <pre tabIndex={0} aria-label={`${installer.shell} download command`}><code>{installer.command.split(" ").map((token, index) => <Fragment key={index}>{index ? " " : ""}<span data-command-token={/^https?:/.test(token) ? "url" : "word"}>{token}</span></Fragment>)}</code></pre>
          <Button variant="ghost" aria-label="Copy download command" onClick={() => void copyCommand()}>{copyStatus === "Command copied" ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}</Button>
        </div>
        <Text as="small" role="status" className="contribution-terminal-status">{copyStatus || `Run in ${installer.shell} to download the latest installer · ${installer.note}`}</Text>
      </div>
      <Text as="small" className="contribution-terminal-next">Then open the installer and <Link href="/downloads">pair the node with your account</Link>. Installing alone doesn't start earning.</Text>
    </div>
  </section>;
}

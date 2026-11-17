import { AndroidDownload } from "./AndroidDownload";
import { useEffect, useState } from "react";
import { Apple, Download, Monitor, Smartphone, Terminal } from "lucide-react";
import { desktopLatestDownloadPath, isDesktopDownloadCatalog, type DesktopDownloadCatalog } from "../../src/contracts/desktop-downloads";
import { Button, Card, Disclosure, DisclosureSummary, Heading, Link, Text } from "./ui/primitives";
import { MarketingHeader, MarketingFooter } from "./rebrand/MarketingHeader";
import { detectInstaller, type InstallerId } from "./detect-installer";
import "./desktop-downloads.css";

export { detectInstaller };

/** Accessible and catalog name of each installer. */
const platformLabel = (id: string) => id === "windows-x64" ? "Windows" : id === "macos-arm64" ? "Mac (Apple Silicon)" : id === "macos-x64" ? "Mac (Intel)" : id === "fedora-x64" ? "Fedora" : "Linux";
const recommendedName = (id: InstallerId) => id === "windows-x64" ? "Windows" : id.startsWith("macos-") ? "macOS" : "Linux";
const formatSize = (bytes: number) => bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${Math.ceil(bytes / 1_000_000)} MB`;

type Package = { id: InstallerId; path: string; bytes: number };
type System = "macos" | "windows" | "linux";
const SYSTEMS: Array<{ id: System; name: string; Icon: typeof Apple; rows: Array<[string, string]>; installers: Array<{ id: InstallerId; label: string; detail: string }>; steps: string }> = [
  { id: "macos", name: "macOS", Icon: Apple,
    rows: [["System", "macOS 13 or later"], ["Processor", "Apple chip (M1 or newer) or Intel"], ["File", "Disk image (DMG)"]],
    installers: [
      { id: "macos-arm64", label: "M1 or newer", detail: "Most Macs from 2021 on" },
      { id: "macos-x64", label: "Intel", detail: "Macs from 2020 and earlier" },
    ],
    steps: "Open the DMG and drag Mycellios Desktop to Applications. This preview is not notarized by Apple yet: if macOS blocks the first opening, open System Settings → Privacy & Security and choose Open Anyway for Mycellios Desktop. Not sure which Mac you have? Apple menu → About This Mac shows Chip (Apple) or Processor (Intel)." },
  { id: "windows", name: "Windows", Icon: Monitor,
    rows: [["System", "Windows 10 or 11"], ["Processor", "64-bit, Intel or AMD"], ["File", "Installer (.exe)"]],
    installers: [{ id: "windows-x64", label: "Windows x64", detail: "Windows 10 / 11 · 64-bit" }],
    steps: "Run the installer. Windows may show a SmartScreen notice for this preview: choose More info → Run anyway. Mycellios Desktop opens when installation finishes." },
  { id: "linux", name: "Linux", Icon: Terminal,
    rows: [["System", "64-bit Ubuntu, Debian or Fedora"], ["Processor", "x64"], ["File", "DEB or RPM package"]],
    installers: [
      { id: "linux-x64", label: "Ubuntu / Debian", detail: "Ubuntu / Debian · 64-bit · DEB" },
      { id: "fedora-x64", label: "Fedora", detail: "Fedora · 64-bit · RPM" },
    ],
    steps: "Open the package with your software installer. On Fedora you can also install the downloaded RPM with dnf." },
];

export function DesktopDownloads() {
  const [recommended, setRecommended] = useState<InstallerId | "">("");
  useEffect(() => { let active = true; void detectInstaller().then(id => { if (active) setRecommended(id); }).catch(() => {}); return () => { active = false; }; }, []);
  const [catalog, setCatalog] = useState<DesktopDownloadCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setFailed(false);
    void fetch("/public/v1/desktop-downloads?include=macos-all", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
      .then(async r => { if (!r.ok) throw Error("Release unavailable"); const value: unknown = await r.json(); if (!isDesktopDownloadCatalog(value)) throw Error("Invalid release"); if (active) setCatalog(value); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; controller.abort(); };
  }, [attempt]);
  const fedoraPackage = catalog?.fedora;
  const packageFor = (id: InstallerId): Package | undefined => failed ? undefined : id === "fedora-x64" ? fedoraPackage : catalog?.packages.find(p => p.id === id);
  const versions = catalog ? [
    ...catalog.packages.map(p => ({platform:platformLabel(p.id),version:p.version ?? catalog.version})),
    ...(fedoraPackage ? [{platform:"Fedora",version:fedoraPackage.version}] : []),
  ] : [];
  const versionLabel = catalog ? (versions.every(p => p.version === catalog.version)
    ? `Version ${catalog.version}` : versions.map(p => `${p.platform} ${p.version}`).join(" · ")) + " · Preview" : "Checking downloads…";
  const separateSources = catalog?.packages.some(p => p.source !== undefined);
  const suggested = recommended ? packageFor(recommended) : undefined;
  const recommendedSystem = recommended ? (recommended.startsWith("macos-") ? "macos" : recommended === "windows-x64" ? "windows" : "linux") : undefined;
  return <main className="marketing-page desktop-download-page"><MarketingHeader /><div className="desktop-downloads">
    <section className="desktop-hero" aria-labelledby="desktop-title">
      <Heading as="h1" id="desktop-title">Download Mycellios</Heading>
      <Text className="desktop-intro">Your agents and projects, in one app. Free for Mac, Windows and Linux, with an app for Android. Get the installer for this computer, or choose a system below.</Text>
      {suggested && recommended ? <div className="desktop-suggested">
        <Link variant="primary" size="lg" href={desktopLatestDownloadPath(suggested.id)}><Download size={18} aria-hidden="true" />Download for {recommendedName(recommended)}</Link>
        <Text className="desktop-suggested-detail">{recommended === "macos-arm64" ? "For Macs with an Apple chip (M1 or newer)" : recommended === "macos-x64" ? "For Macs with an Intel processor" : platformLabel(recommended)} · {formatSize(suggested.bytes)}</Text>
      </div> : null}
      {failed ? <div role="alert"><Text>Downloads could not be checked. Please try again.</Text><Button onClick={() => setAttempt(v => v + 1)}>Try again</Button></div> : null}
    </section>
    <div className="desktop-systems" aria-label="Desktop installers">
      {SYSTEMS.map(({ id: system, name, Icon, rows, installers, steps }) => <Card className="desktop-system" data-recommended={system === recommendedSystem || undefined} key={system} aria-labelledby={`desktop-${system}`}>
        <Icon size={28} aria-hidden="true" />
        <Heading as="h2" id={`desktop-${system}`}>{name}</Heading>
        <dl className="desktop-specs">{rows.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>
        <div className="desktop-installers">
          {installers.map(({ id, label, detail }) => {
            const pkg = packageFor(id);
            const primary = id === recommended || (!recommended || recommendedSystem !== system) && id === installers[0]!.id;
            return <div className="desktop-installer" key={id}>
              {pkg ? <Link variant={primary ? "primary" : "secondary"} size="md" aria-label={`Download for ${platformLabel(id)}`} href={desktopLatestDownloadPath(id)}><Download size={16} aria-hidden="true" />{label}</Link>
                : <Button variant={primary ? "primary" : "secondary"} size="md" disabled aria-label={`Download for ${platformLabel(id)}`}>{label}</Button>}
              <Text className="desktop-installer-detail">{id === "fedora-x64" && fedoraPackage ? `${detail} · ${fedoraPackage.version}` : detail}</Text>
              {pkg ? <Text className="desktop-installer-size">{formatSize(pkg.bytes)}</Text> : null}
            </div>;
          })}
        </div>
        <Disclosure className="desktop-steps ui-animated-disclosure"><DisclosureSummary>Requirements and install steps</DisclosureSummary><div className="ui-disclosure-body"><Text>{steps}</Text></div></Disclosure>
      </Card>)}
      <Card className="desktop-system" aria-labelledby="desktop-android">
        <Smartphone size={28} aria-hidden="true" />
        <Heading as="h2" id="desktop-android">Android</Heading>
        <dl className="desktop-specs"><div><dt>System</dt><dd>Android 8 or later</dd></div><div><dt>File</dt><dd>App package (APK)</dd></div><div><dt>Needs</dt><dd>Your Mycellios account</dd></div></dl>
        <div className="desktop-installers"><div className="desktop-installer"><Link variant="secondary" size="md" href="#android-title">Get the Android app</Link></div></div>
      </Card>
    </div>
    <Text className="desktop-version">{versionLabel}</Text>
    <Text className="desktop-notice">Preview. Windows and macOS may ask for approval the first time they open it.</Text>
    <Disclosure className="desktop-details ui-animated-disclosure"><DisclosureSummary>Updates, checksums &amp; source</DisclosureSummary><div className="ui-disclosure-body">
      <Text>Install the app and sign in with your Mycellios account.</Text>
      {fedoraPackage ? <Text>On Fedora, open the RPM with your software installer or run <code>sudo dnf install ./{fedoraPackage.fileName}</code>.</Text> : null}
      <Text>Recent Desktop builds download updates in the background. Signed channels can install when idle. This preview asks you to approve installation through the system installer. Your account, chats and project settings are kept.</Text>
      <Text>The contribution runtime is included for Windows, Linux and Apple Silicon. Intel Macs can use agents and local projects; compute contribution is not available yet. Joining the network requires your account and permission.</Text>
      {catalog ? <div className="desktop-checksums">{catalog.packages.map(p => <div key={p.id}><Text><strong>{platformLabel(p.id)}</strong> · {p.format} · {Math.ceil(p.bytes / 1_000_000)} MB<code>{p.sha256}</code></Text>{separateSources ? <Link href={(p.source ?? catalog.source).path}>{platformLabel(p.id)} source code and build information</Link> : null}</div>)}{!separateSources ? <Link href={catalog.source.path}>Source code and build information</Link> : null}</div> : null}
      {fedoraPackage ? <div className="desktop-checksums"><Text><strong>Fedora</strong> · RPM · Version {fedoraPackage.version} · {Math.ceil(fedoraPackage.bytes / 1_000_000)} MB<code>{fedoraPackage.sha256}</code></Text><Link href={fedoraPackage.source.path}>Fedora source code and build information</Link></div> : null}
      <footer><Link href="/downloads?product=runtime">Standalone runtime</Link><Link href="https://github.com/Mycellios/mycellios/releases">All releases on GitHub</Link></footer>
    </div></Disclosure>
    <AndroidDownload />
  </div><MarketingFooter /></main>;
}

import { AndroidDownload } from "./AndroidDownload";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { desktopLatestDownloadPath, isDesktopDownloadCatalog, type DesktopDownloadCatalog } from "../../src/contracts/desktop-downloads";
import { Button, Disclosure, DisclosureSummary, Heading, Link, Text } from "./ui/primitives";
import { MarketingHeader, MarketingFooter } from "./rebrand/MarketingHeader";
import "./desktop-downloads.css";

const platformLabel = (id: string) => id === "windows-x64" ? "Windows" : id === "macos-arm64" ? "Mac (Apple Silicon)" : id === "macos-x64" ? "Mac (Intel)" : id === "fedora-x64" ? "Fedora" : "Linux";

export function DesktopDownloads() {
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
  const versions = catalog ? [
    ...catalog.packages.map(p => ({platform:platformLabel(p.id),version:p.version ?? catalog.version})),
    ...(fedoraPackage ? [{platform:"Fedora",version:fedoraPackage.version}] : []),
  ] : [];
  const versionLabel = catalog ? (versions.every(p => p.version === catalog.version)
    ? `Version ${catalog.version}` : versions.map(p => `${p.platform} ${p.version}`).join(" · ")) + " · Preview" : "Checking downloads…";
  const separateSources = catalog?.packages.some(p => p.source !== undefined);
  return <main className="marketing-page desktop-download-page"><MarketingHeader /><div className="desktop-downloads">
    <section aria-labelledby="desktop-title">
      <Heading as="h1" id="desktop-title">Mycellios Desktop</Heading>
      <Text className="desktop-intro">Your agents and projects, in one app.</Text>
      <Link href="#android-title">Android app</Link>
      {failed ? <div role="alert"><Text>Downloads could not be checked. Please try again.</Text><Button onClick={() => setAttempt(v => v + 1)}>Try again</Button></div> : null}
      <div className="desktop-packages" aria-label="Desktop installers">
        {(["windows-x64", "macos-arm64", "macos-x64", "linux-x64", "fedora-x64"] as const).map(id => {
          const fedora = id === "fedora-x64";
          const pkg = fedora ? fedoraPackage : catalog?.packages.find(p => p.id === id);
          const platform = platformLabel(id);
          return <div className="desktop-package" key={id}>
            <div><Heading as="h2">{platform}</Heading><Text>{id === "windows-x64" ? "Windows 10 / 11 · 64-bit" : id === "macos-arm64" ? "M1 or later · macOS 13 or later" : id === "macos-x64" ? "Intel · macOS 13 or later" : fedora ? "Fedora · 64-bit · RPM" + (fedoraPackage ? ` · ${fedoraPackage.version}` : "") : "Ubuntu / Debian · 64-bit"}</Text></div>
            {pkg && !failed ? <Link variant="primary" size="lg" aria-label={`Download for ${platform}`} href={desktopLatestDownloadPath(pkg.id)}><Download size={18} aria-hidden="true" />Download</Link> : <Button variant="primary" size="lg" disabled aria-label={`Download for ${platform}`}>Download</Button>}
          </div>;
        })}
      </div>
      <Text className="desktop-version">{versionLabel}</Text>
      <Text className="desktop-notice">Preview. Windows and macOS may require approval before opening.</Text>
    </section>
    <Disclosure className="desktop-details ui-animated-disclosure"><DisclosureSummary>Installation &amp; details</DisclosureSummary><div className="ui-disclosure-body">
      <Text>Install the app and sign in with your Mycellios account. On Ubuntu / Debian, open the DEB with your software installer.</Text>
      <Text>On a Mac, choose the download for your processor, open the DMG and drag Mycellios Desktop to Applications. This preview is not notarized by Apple. If macOS blocks the first opening, review Mycellios Desktop in System Settings → Privacy &amp; Security and use Open Anyway for this app.</Text>
      {fedoraPackage ? <Text>On Fedora, open the RPM with your software installer or run <code>sudo dnf install ./{fedoraPackage.fileName}</code>.</Text> : null}
      <Text>Recent Desktop builds download updates in the background. Signed channels can install when idle. This preview asks you to approve installation through the system installer. Your account, chats and project settings are kept.</Text>
      <Text>The contribution runtime is included for Windows, Linux and Apple Silicon. Intel Macs can use agents and local projects; compute contribution is not available yet. Joining the network requires your account and permission.</Text>
      {catalog ? <div className="desktop-checksums">{catalog.packages.map(p => <div key={p.id}><Text><strong>{platformLabel(p.id)}</strong> · {p.format} · {Math.ceil(p.bytes / 1_000_000)} MB<code>{p.sha256}</code></Text>{separateSources ? <Link href={(p.source ?? catalog.source).path}>{platformLabel(p.id)} source code and build information</Link> : null}</div>)}{!separateSources ? <Link href={catalog.source.path}>Source code and build information</Link> : null}</div> : null}
      {fedoraPackage ? <div className="desktop-checksums"><Text><strong>Fedora</strong> · RPM · Version {fedoraPackage.version} · {Math.ceil(fedoraPackage.bytes / 1_000_000)} MB<code>{fedoraPackage.sha256}</code></Text><Link href={fedoraPackage.source.path}>Fedora source code and build information</Link></div> : null}
      <footer><Link href="/downloads?product=runtime">Standalone runtime</Link><Link href="https://github.com/Mycellios/mycellios">GitHub</Link></footer>
    </div></Disclosure>
    <AndroidDownload />
  </div><MarketingFooter /></main>;
}

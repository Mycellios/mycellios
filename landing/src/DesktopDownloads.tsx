import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { isDesktopDownloadCatalog, type DesktopDownloadCatalog } from "../../src/contracts/desktop-downloads";
import { Button, Disclosure, DisclosureSummary, Heading, Link, Text } from "./ui/primitives";
import "./desktop-downloads.css";

export function DesktopDownloads() {
  const [catalog, setCatalog] = useState<DesktopDownloadCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setFailed(false);
    void fetch("/public/v1/desktop-downloads", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
      .then(async r => { if (!r.ok) throw Error("Release unavailable"); const value: unknown = await r.json(); if (!isDesktopDownloadCatalog(value)) throw Error("Invalid release"); if (active) setCatalog(value); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; controller.abort(); };
  }, [attempt]);
  return <main className="public-panel desktop-downloads">
    <header><Link href="/" className="desktop-wordmark">Mycellios</Link><Link href="/agent/app">Use in your browser</Link></header>
    <section aria-labelledby="desktop-title">
      <Heading as="h1" id="desktop-title">Mycellios Desktop</Heading>
      <Text className="desktop-intro">Your agents and projects, in one app.</Text>
      {failed ? <div role="alert"><Text>Downloads could not be checked. Please try again.</Text><Button onClick={() => setAttempt(v => v + 1)}>Try again</Button></div> : null}
      <div className="desktop-packages" aria-label="Desktop installers">
        {(["windows-x64", "linux-x64"] as const).map(id => {
          const pkg = catalog?.packages.find(p => p.id === id);
          const platform = id === "windows-x64" ? "Windows" : "Linux";
          return <div className="desktop-package" key={id}>
            <div><Heading as="h2">{platform}</Heading><Text>{id === "windows-x64" ? "Windows 10 / 11 · 64-bit" : "Ubuntu / Debian · 64-bit"}</Text></div>
            {pkg && !failed ? <Link variant="primary" size="lg" aria-label={`Download for ${platform}`} href={pkg.path} download={pkg.fileName}><Download size={18} aria-hidden="true" />Download</Link> : <Button variant="primary" size="lg" disabled aria-label={`Download for ${platform}`}>Download</Button>}
          </div>;
        })}
      </div>
      <Text className="desktop-version">{catalog ? `Version ${catalog.version} · Preview` : "Checking downloads…"} · macOS not available yet.</Text>
      <Text className="desktop-notice">Windows may show a publisher warning: these installers are not signed yet.</Text>
    </section>
    <Disclosure className="desktop-details"><DisclosureSummary>Installation &amp; details</DisclosureSummary>
      <Text>Install the app and sign in with your Mycellios account. On Linux, open the DEB with your software installer.</Text>
      <Text>To update, close Desktop and run the new installer. Your account, chats and project settings are kept. Updates are manual for now.</Text>
      <Text>The contribution runtime is included. Joining the network requires your account and permission.</Text>
      {catalog ? <div className="desktop-checksums">{catalog.packages.map(p => <Text key={p.id}><strong>{p.id === "windows-x64" ? "Windows" : "Linux"}</strong> · {p.format} · {Math.ceil(p.bytes / 1_000_000)} MB<code>{p.sha256}</code></Text>)}<Link href={catalog.source.path}>Source code and build information</Link></div> : null}
      <footer><Link href="/downloads?product=runtime">Standalone runtime</Link><Link href="https://github.com/Mycellios/mycellios">GitHub</Link></footer>
    </Disclosure>
  </main>;
}

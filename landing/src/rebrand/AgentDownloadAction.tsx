import { useEffect, useRef, useState } from "react";
import { Apple, ArrowDownToLine, ChevronDown, Monitor, Smartphone, Terminal } from "lucide-react";
import { desktopLatestDownloadPath, isDesktopDownloadCatalog, type DesktopDownloadCatalog } from "../../../src/contracts/desktop-downloads";
import { Button, Link, Text } from "../ui/primitives";
import "./agent-download-action.css";

export const downloadPlatforms = [
  { id: "windows-x64", label: "Windows", detail: "Windows 10 / 11 · x64" },
  { id: "macos-arm64", label: "Mac · Apple Silicon", detail: "M1 or later" },
  { id: "macos-x64", label: "Mac · Intel", detail: "Intel processor" },
  { id: "linux-x64", label: "Linux", detail: "Ubuntu / Debian · DEB" },
  { id: "fedora-x64", label: "Fedora", detail: "Linux · RPM" },
] as const;

export function suggestedDownload(platform: string) {
  if (/android|iphone|ipad/i.test(platform)) return { id: undefined, label: undefined };
  if (/win/i.test(platform)) return { id: "windows-x64", label: "Windows" };
  // A browser cannot reliably identify the Mac's CPU. Let the user choose it.
  if (/mac/i.test(platform)) return { id: undefined, label: "Mac" };
  if (/linux/i.test(platform) && !/android/i.test(platform)) return { id: "linux-x64", label: "Linux" };
  return { id: undefined, label: undefined };
}

export function AgentDownloadAction() {
  const [catalog, setCatalog] = useState<DesktopDownloadCatalog | null>(null);
  const [suggested, setSuggested] = useState<ReturnType<typeof suggestedDownload>>({ id: undefined, label: undefined });
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setSuggested(suggestedDownload(navigator.userAgent));
    let active = true;
    const controller = new AbortController();
    void fetch("/public/v1/desktop-downloads?include=macos-all", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
      .then(async response => { if (!response.ok) return; const data: unknown = await response.json(); if (active && isDesktopDownloadCatalog(data)) setCatalog(data); })
      .catch(() => { /* The complete downloads page remains available offline or on catalog failure. */ });
    return () => { active = false; controller.abort(); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const preferred = catalog?.packages.find(pkg => pkg.id === suggested.id);
  return <div className="agent-download" ref={root}>
    <div className="agent-download-split">
      <Link variant="primary" size="xl" className="agent-download-primary" href={preferred ? desktopLatestDownloadPath(preferred.id) : "/downloads/desktop"}>
        <ArrowDownToLine size={19} aria-hidden="true" />Download{suggested.label ? ` for ${suggested.label}` : " Mycellios"}
      </Link>
      <Button ref={toggle} variant="primary" size="xl" className="agent-download-toggle" aria-label="Choose a download platform" aria-expanded={open} aria-controls="agent-download-platforms" onClick={() => setOpen(value => !value)}><ChevronDown size={17} aria-hidden="true" /></Button>
    </div>
    {open && <div className="agent-download-menu" id="agent-download-platforms" aria-label="Download Mycellios">
      <Text className="agent-download-menu-title">Get Mycellios</Text>
      {downloadPlatforms.map(({ id, label, detail }) => {
        // Avoid capturing an uninitialised icon from a shared chunk at module load.
        const Icon = id === "windows-x64" ? Monitor : id.startsWith("macos-") ? Apple : Terminal;
        const pkg = id === "fedora-x64" ? catalog?.fedora : catalog?.packages.find(item => item.id === id);
        return pkg ? <Link key={id} href={desktopLatestDownloadPath(id)} onClick={() => setOpen(false)}><Icon size={18} aria-hidden="true" /><span>{label}<small>{detail}</small></span><ArrowDownToLine size={15} aria-hidden="true" /></Link> : null;
      })}
      <Link href="/downloads/desktop#android-title"><Smartphone size={18} aria-hidden="true" /><span>Android<small>App &amp; installation details</small></span></Link>
      <Link className="agent-download-all" href="/downloads/desktop">All downloads &amp; installation details</Link>
    </div>}
  </div>;
}

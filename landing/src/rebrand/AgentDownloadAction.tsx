import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDownToLine, ChevronDown } from "lucide-react";
import { desktopLatestDownloadPath, isDesktopDownloadCatalog, type DesktopDownloadCatalog } from "../../../src/contracts/desktop-downloads";
import { Button, Link } from "../ui/primitives";
import { detectInstaller, type InstallerId } from "../detect-installer";
import { PlatformLogo, type PlatformLogoId } from "./PlatformLogo";
import "./agent-download-action.css";

/**
 * Desktop entries of the platform menu. macOS is two entries because a browser
 * cannot reliably tell an Intel Mac from an Apple silicon Mac, and the Apple
 * silicon installer does not open on an Intel Mac.
 */
export const downloadPlatforms = [
  { id: "macos-arm64", system: "macos", label: "macOS · Apple silicon" },
  { id: "macos-x64", system: "macos", label: "macOS · Intel" },
  { id: "windows-x64", system: "windows", label: "Windows" },
  { id: "linux-x64", system: "linux", label: "Linux · DEB" },
  { id: "fedora-x64", system: "linux", label: "Linux · RPM" },
] as const satisfies ReadonlyArray<{ id: InstallerId; system: PlatformLogoId; label: string }>;

const ANDROID = "android";
type MenuPlatform = InstallerId | typeof ANDROID;
const SYSTEM_NAMES: Record<PlatformLogoId, string> = { macos: "macOS", windows: "Windows", linux: "Linux", android: "Android" };
const systemOf = (id: MenuPlatform): PlatformLogoId => id === ANDROID ? "android" : downloadPlatforms.find(p => p.id === id)!.system;

export function suggestedDownload(platform: string) {
  if (/android|iphone|ipad/i.test(platform)) return { id: undefined, label: undefined };
  if (/win/i.test(platform)) return { id: "windows-x64", label: "Windows" };
  // The user agent alone cannot identify the Mac's CPU; detectInstaller adds hints.
  if (/mac/i.test(platform)) return { id: undefined, label: "macOS" };
  if (/linux/i.test(platform) && !/android/i.test(platform)) return { id: "linux-x64", label: "Linux" };
  return { id: undefined, label: undefined };
}

export function AgentDownloadAction() {
  const [catalog, setCatalog] = useState<DesktopDownloadCatalog | null>(null);
  const [selected, setSelected] = useState<MenuPlatform | "">("");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const quick = suggestedDownload(navigator.userAgent).id;
    if (quick) setSelected(quick);
    void detectInstaller().then(id => { if (id) setSelected(id); }).catch(() => {});
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
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const packageFor = (id: InstallerId) => id === "fedora-x64" ? catalog?.fedora : catalog?.packages.find(pkg => pkg.id === id);
  // Until the catalog answers, desktop entries open the downloads page instead of
  // claiming an installer is published.
  const hrefFor = (id: MenuPlatform) => id === ANDROID ? "/downloads/desktop#android-title" : !catalog ? "/downloads/desktop" : packageFor(id) ? desktopLatestDownloadPath(id) : undefined;
  const confirmed = (id: MenuPlatform) => id === ANDROID || Boolean(catalog && packageFor(id));
  const menuItems = () => Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) toggle.current?.focus(); };
  const show = (focus: "first" | "last" | false = false) => {
    setOpen(true);
    if (focus) queueMicrotask(() => { const items = menuItems(); (focus === "first" ? items[0] : items.at(-1))?.focus(); });
  };
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && open) { event.preventDefault(); close(true); return; }
    if (event.target === toggle.current && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); show(event.key === "ArrowDown" ? "first" : "last"); return; }
    if (!open || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = menuItems(), index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    event.preventDefault(); items[next]?.focus();
  }

  // One click downloads this computer's installer; every other one is in the menu.
  const primaryHref = selected && confirmed(selected) ? hrefFor(selected) : undefined;
  const primarySystem = selected ? systemOf(selected) : undefined;
  const item = (id: MenuPlatform, label: string) => {
    const href = hrefFor(id);
    return href ? <Link key={id} className="agent-download-item" href={href} role="menuitem" data-selected={selected === id || undefined} onClick={() => { setSelected(id); close(true); }}>
      <PlatformLogo platform={systemOf(id)} /><span>{label}</span>{confirmed(id) ? <small>Available</small> : null}
    </Link> : null;
  };
  return <div className="agent-download" ref={root}>
    <div className="agent-download-split">
      <Link variant="primary" size="xl" className="agent-download-primary" href={primaryHref ?? "/downloads/desktop"}>
        {primaryHref && primarySystem ? <PlatformLogo platform={primarySystem} /> : <ArrowDownToLine size={19} aria-hidden="true" />}
        {primaryHref && primarySystem ? (primarySystem === "android" ? "Get the Android app" : `Download for ${SYSTEM_NAMES[primarySystem]}`) : "Download Mycellios"}
      </Link>
      <Button ref={toggle} variant="primary" size="xl" className="agent-download-toggle" aria-label="Choose a download platform" aria-haspopup="menu" aria-expanded={open} aria-controls="agent-download-platforms" onClick={() => open ? close() : show()} onKeyDown={onKeyDown}><ChevronDown size={17} aria-hidden="true" /></Button>
    </div>
    {open && <div className="agent-download-menu" id="agent-download-platforms" role="menu" aria-label="Download platforms" onKeyDown={onKeyDown}>
      {downloadPlatforms.map(({ id, label }) => item(id, label))}
      <hr className="agent-download-separator" />
      <span className="agent-download-menu-label" aria-hidden="true">Phone apps</span>
      {item(ANDROID, "Android · APK")}
    </div>}
  </div>;
}

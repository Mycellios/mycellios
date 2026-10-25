import { Button as UiButton, Card as UiCard, Heading as UiHeading, Link as UiLink, Text as UiText } from "./ui/primitives";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Download, Laptop, Globe2 } from "lucide-react";
import type { PublicDownloadAvailability } from "../../src/contracts/public-downloads.js";
import { fetchPublicDownloadAvailability, PUBLIC_DOWNLOAD_OPTIONS } from "./public-downloads";

export function downloadAvailabilityNotice(
  availability: PublicDownloadAvailability | null,
  availabilityFailed: boolean,
  requestedPlatform: string | null,
  availabilityReason: string | null,
): { title: string; detail: string } | null {
  if (availabilityFailed) return {
    title: "Could not check package status",
    detail: availabilityReason === "unsupported"
      ? "No Fedora / RHEL RPM package is offered. Current archive availability could not be checked; review the public releases or try the browser worker."
      : "Current package availability could not be checked. Review the public releases or try the browser worker.",
  };
  if (availabilityReason === "unsupported") return {
    title: "Package format unavailable",
    detail: "No Fedora / RHEL RPM package is offered. Check whether the Linux x64 archive is currently published, or try the browser worker.",
  };
  if (!availability) return null;
  const requestedOption = PUBLIC_DOWNLOAD_OPTIONS.find((option) => option.id === requestedPlatform);
  if (requestedOption) {
    if (availability.packages.find((item) => item.id === requestedOption.id)?.available) return null;
    return {
      title: "Package unavailable",
      detail: `The ${requestedOption.label} ${requestedOption.format} package is not currently published.`,
    };
  }
  if (availability.packages.some((item) => item.available)) return null;
  return {
    title: "Packages unavailable",
    detail: "No native packages are currently published. Try the browser worker or check the public releases.",
  };
}

export function DownloadsPage({
  title,
  publicLink,
  external,
  loadAvailability = fetchPublicDownloadAvailability,
}: {
  title: ReactNode;
  publicLink: (path: string) => string;
  external: boolean;
  loadAvailability?: typeof fetchPublicDownloadAvailability;
}) {
  const [availability, setAvailability] = useState<PublicDownloadAvailability | null>(null);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void loadAvailability(controller.signal).then((result) => {
      if (active) setAvailability(result);
    }).catch(() => { /* The platform route can resolve the current release if status is unavailable. */ });
    return () => { active = false; controller.abort(); };
  }, [loadAvailability]);

  const params = new URLSearchParams(window.location.search);
  const requestedPlatform = params.get("platform");
  const [selectedPlatform, setSelectedPlatform] = useState(() =>
    PUBLIC_DOWNLOAD_OPTIONS.find((option) => option.id === requestedPlatform)?.id
    ?? (/Mac/i.test(navigator.platform) ? "macos-arm64" : /Linux/i.test(navigator.platform) ? "linux-x64" : "windows-x64"),
  );
  const [route, setRoute] = useState<"native" | "browser">("native");

  return <section className="connect-studio minimal-screen">
    {title}
    <div className="connect-studio-workspace">
      <div className="connect-route-picker" aria-label="Contribution method">
        <UiButton type="button" className={route === "native" ? "selected" : ""} aria-pressed={route === "native"} onClick={() => setRoute("native")}><Laptop size={21} /><span><strong>On your computer</strong></span><ArrowRight size={17} /></UiButton>
        <UiButton type="button" className={route === "browser" ? "selected" : ""} aria-pressed={route === "browser"} onClick={() => setRoute("browser")}><Globe2 size={21} /><span><strong>In your browser</strong></span><ArrowRight size={17} /></UiButton>
      </div>
      <div className="connect-route-content">
      {route === "browser" ? <UiCard className="connect-browser-route"><UiHeading as="h2">Browser worker</UiHeading><UiText>Keep the tab open while contributing.</UiText><UiLink className="connect-primary-action" href={publicLink("/browser/")} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>Open browser worker <ArrowRight size={17} /></UiLink></UiCard> : <>
      <div className="connect-platforms" aria-label="Operating system">{PUBLIC_DOWNLOAD_OPTIONS.map((option) => <UiButton type="button" key={option.id} aria-pressed={selectedPlatform === option.id} className={selectedPlatform === option.id ? "selected" : ""} onClick={() => setSelectedPlatform(option.id)}>{option.label}</UiButton>)}</div>
      <div className="download-grid">{PUBLIC_DOWNLOAD_OPTIONS.filter((option) => option.id === selectedPlatform).map((option) => {
      const pkg = availability?.packages.find((item) => item.id === option.id);
      const available = pkg?.available === true;
      return <UiCard className={`download-card${available ? " ready" : " unavailable"}`} key={option.id}>
        <UiHeading as="h2">{option.detail}</UiHeading>
        {pkg && !available
          ? <UiButton className="download-card-action" variant="primary" disabled title="No release is published for this platform yet.">Download <Download /></UiButton>
          : <UiLink className="download-card-action" href={publicLink(pkg?.path ?? option.path)} download={pkg?.fileName ?? true}>Download <Download /></UiLink>}
      </UiCard>;
    })}</div>
      </>}
      </div>
    </div>
  </section>;
}

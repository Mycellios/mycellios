import { useLingui } from "@lingui/react/macro";
import { BotAvatar } from "@mycellios/ui-web";
import { useIsMobile } from "@mycellios/ui-web/hooks/use-mobile";
import { X } from "lucide-react";
import { useState } from "react";
import { desktopBridge } from "../lib/desktop";
import "./chrome-extension-card.css";

/** The published Mycellios Agent listing (README: Chrome Web Store ID). */
export const CHROME_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/mycellios-agent/nohdakjpcmhfgoaemmhkjkmobhenfcpf";
const DISMISSED_KEY = "mycellios.chrome-extension-card.dismissed";

function readDismissed(): boolean {
  try { return window.localStorage.getItem(DISMISSED_KEY) === "true"; } catch { return false; }
}

/**
 * The extension installs in Chromium browsers on a computer. The Desktop app always offers it
 * (its owner browses in another app); a browser offers it only when it is Chromium-based. Never
 * inside a frame, which is where the extension's own side panel shows this app.
 */
export function chromeExtensionOffered(): boolean {
  if (typeof window === "undefined" || window.top !== window.self) return false;
  if (desktopBridge()) return true;
  const brands = (navigator as Navigator & { userAgentData?: { brands?: Array<{ brand: string }> } })
    .userAgentData?.brands;
  if (brands) return brands.some(({ brand }) => brand === "Chromium");
  return /\b(Chrome|Chromium|Edg)\//.test(navigator.userAgent) && !/\bMobile\b/.test(navigator.userAgent);
}

/** A flat Chrome mark: three slices around a blue centre. */
function ChromeMark({ size = 16 }: { size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" className="shrink-0">
    <path d="M24 24 4.95 13A22 22 0 0 1 43.05 13Z" fill="#EA4335" />
    <path d="M24 24 43.05 13A22 22 0 0 1 24 46Z" fill="#FBBC04" />
    <path d="M24 24 24 46A22 22 0 0 1 4.95 13Z" fill="#34A853" />
    <circle cx="24" cy="24" r="10.5" fill="#FFFFFF" />
    <circle cx="24" cy="24" r="8" fill="#4285F4" />
  </svg>;
}

/**
 * Sidebar notice for the Chrome extension, as the reference app announces its own: a small
 * browser with the Mico's panel beside a page, the Mico peeking from its corner, and one action
 * that opens the store listing. Closing it keeps it closed on this device.
 */
export function ChromeExtensionCard({ mico }: { mico?: { id: string; color: string } }) {
  const { t } = useLingui();
  const mobile = useIsMobile();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [offered] = useState(chromeExtensionOffered);
  if (dismissed || mobile || !offered) return null;
  const dismiss = () => {
    setDismissed(true);
    try { window.localStorage.setItem(DISMISSED_KEY, "true"); } catch { /* Closed for this visit only. */ }
  };
  return <section className="rk-chrome-card" aria-labelledby="rk-chrome-card-title">
    <button type="button" className="rk-chrome-card-close" aria-label={t`Close the Chrome extension notice`} onClick={dismiss}>
      <X size={14} aria-hidden="true" />
    </button>
    <div className="rk-chrome-stage" aria-hidden="true">
      <div className="rk-chrome-window">
        <div className="rk-chrome-bar">
          <span className="rk-chrome-lights"><i /><i /><i /></span>
          <span className="rk-chrome-address"><ChromeMark size={9} /></span>
        </div>
        <div className="rk-chrome-view">
          <div className="rk-chrome-page"><b /><i /><i /><i /></div>
          <div className="rk-chrome-panel">
            <span className="rk-chrome-bubble" />
            <span className="rk-chrome-typing"><i /><i /><i /></span>
          </div>
        </div>
      </div>
      <span className="rk-chrome-mico">
        <BotAvatar color={mico?.color ?? "purple"} identity={mico?.id ?? "chrome-card"} size={44} />
      </span>
    </div>
    <strong id="rk-chrome-card-title" className="rk-chrome-title">{t`Your Micos, in Chrome`}</strong>
    <a className="rk-chrome-add" href={CHROME_EXTENSION_URL} target="_blank" rel="noopener noreferrer">
      <ChromeMark />
      {t`Add to Chrome`}
    </a>
  </section>;
}

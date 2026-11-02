import { HTML_VIEWER_PATH } from "@rakazo/contracts/content-security-policy";
import { useEffect, useRef, useState } from "react";
import { appPath } from "../lib/app-path";
import type { ReviewSelection } from "../lib/review-workspace";
import { readReviewSelection } from "../lib/review-workspace";

export const PREVIEW_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'";

const PREVIEW_GUARD = `<script>
document.addEventListener("click", (event) => {
  const target = event.target;
  const link = target instanceof Element ? target.closest("a[href]") : null;
  if (!link) return;
  const href = link.getAttribute("href") ?? "";
  event.preventDefault();
  if (href.startsWith("#")) location.hash = href;
}, true);
document.addEventListener("submit", (event) => event.preventDefault(), true);
</script>`;

function previewDocument(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  const referrer = `<meta name="referrer" content="no-referrer">`;
  return `${meta}${referrer}${PREVIEW_GUARD}${html}`;
}

/**
 * The shell at HTML_VIEWER_PATH is a network document, so it does not inherit the app's CSP the
 * way a srcdoc frame would (which would block the preview's inline scripts). It renders the posted
 * document in a nested sandboxed srcdoc frame under the shell's own CSP.
 */
export function SandboxedHtmlViewer({ html, title, inspection }: { html: string; title: string; inspection?: { session: string; enabled: boolean; onSelection: (value: ReviewSelection) => void } }) {
  const frame = useRef<HTMLIFrameElement>(null);
  // Every shell load starts empty, so each one gets the document again.
  const [loads, setLoads] = useState(0);
  const [bridge, setBridge] = useState("");
  useEffect(() => {
    if (!inspection) return;
    let current = true;
    void fetch(appPath("/preview-bridge.js"), { credentials: "omit" }).then(response => {
      if (!response.ok) throw new Error("Preview bridge unavailable");
      return response.text();
    }).then(value => { if (current) setBridge(value); }).catch(() => undefined);
    return () => { current = false; };
  }, [Boolean(inspection)]);
  useEffect(() => {
    // The sandboxed shell has an opaque origin, so there is no narrower target origin to name.
    if (loads > 0) frame.current?.contentWindow?.postMessage(previewDocument(bridge ? `<script>${bridge}</script>${html}` : html), "*");
  }, [loads, html, bridge]);
  useEffect(() => {
    if (!inspection) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.session !== inspection.session) return;
      if (event.data.type === "mycellios:selection" && inspection.enabled) {
        const value = readReviewSelection(event.data);
        if (value) inspection.onSelection(value);
      }
    };
    window.addEventListener("message", receive);
    frame.current?.contentWindow?.postMessage({ type: "mycellios:inspect", session: inspection.session, enabled: inspection.enabled }, "*");
    return () => window.removeEventListener("message", receive);
  }, [inspection?.session, inspection?.enabled, inspection?.onSelection, loads, bridge]);
  return (
    <iframe
      ref={frame}
      title={title}
      src={appPath(HTML_VIEWER_PATH)}
      onLoad={() => setLoads((count) => count + 1)}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className="h-full w-full border-0 bg-white"
    />
  );
}

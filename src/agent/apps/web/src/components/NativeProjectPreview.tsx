import { useLingui } from "@lingui/react/macro";
import type { ProjectBrowserState } from "@rakazo/contracts";
import { useEffect, useRef, useState } from "react";
import { desktopBridge } from "../lib/desktop";

/** A placeholder rectangle; the native page never shares the application's DOM. */
export function NativeProjectPreview({
  id,
  url,
  onChanged,
}: {
  id: string;
  url: string;
  onChanged(state: ProjectBrowserState): void;
}) {
  const { t } = useLingui();
  const viewport = useRef<HTMLDivElement>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const [error, setError] = useState(false);
  useEffect(() => {
    const preview = desktopBridge()?.preview;
    const element = viewport.current;
    if (!preview || !element) return;
    let current = true;
    let shown = false;
    let frame = 0;
    let pending = false;
    let again = false;
    let previous = "";
    const bounds = () => {
      const rect = element.getBoundingClientRect();
      const overlays = document.querySelectorAll(
        '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-slot="popover-content"]',
      );
      if (
        rect.width < 1 ||
        rect.height < 1 ||
        [...overlays].some((item) => item.getClientRects().length > 0)
      )
        return null;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const sync = async () => {
      if (!current) return;
      if (pending) {
        again = true;
        return;
      }
      const rect = bounds();
      const key = JSON.stringify(rect);
      if (shown && key === previous) return;
      pending = true;
      try {
        if (!shown && rect) {
          await preview.show({ id, url, bounds: rect });
          shown = true;
          if (!current) {
            await preview.layout({ id, bounds: null });
            return;
          }
          // A dialog might have opened while native setup was in flight.
          await preview.layout({ id, bounds: bounds() });
        } else if (shown) await preview.layout({ id, bounds: rect });
        previous = key;
        if (current) setError(false);
      } catch {
        if (current) setError(true);
      } finally {
        pending = false;
        if (again) {
          again = false;
          schedule();
        }
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void sync());
    };
    const unsubscribe = preview.onChanged((state) => {
      if (current && state.id === id) changed.current(state);
    });
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    const overlays = new MutationObserver(schedule);
    overlays.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "role",
        "hidden",
        "style",
        "class",
        "open",
        "data-open",
        "data-closed",
        "data-state",
      ],
    });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    schedule();
    return () => {
      current = false;
      cancelAnimationFrame(frame);
      resize.disconnect();
      overlays.disconnect();
      unsubscribe();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      void preview.layout({ id, bounds: null }).catch(() => {});
    };
  }, [id, url]);
  return (
    <section ref={viewport} className="h-full min-h-32 w-full" aria-label={t`Project browser page`}>
      {error && (
        <p
          role="alert"
          className="p-4 text-sm text-destructive"
        >{t`Could not open this page. Check the URL and try again.`}</p>
      )}
    </section>
  );
}

export function selectionScreenshot(value?: string): File | undefined {
  if (!value?.startsWith("data:image/png;base64,") || value.length > 4 * 1024 * 1024 + 100) return;
  try {
    const binary = atob(value.slice("data:image/png;base64,".length));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new File([bytes], "selected-element.png", { type: "image/png" });
  } catch {
    return;
  }
}

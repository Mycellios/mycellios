import { Button as UiButton, DialogPanel as UiDialogPanel, Link as UiLink } from "./ui/primitives";
import { Check, ChevronDown, ChevronRight, Copy, Download, Globe2, Network, Share2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export function EarnQuickMenu({
  earnUrl,
  browserUrl,
  downloadsUrl,
  external,
  onOpenEarn,
}: {
  earnUrl: string;
  browserUrl: string;
  downloadsUrl: string;
  external: boolean;
  onOpenEarn: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const externalProps = external ? { target: "_blank", rel: "noreferrer" } as const : {};

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => () => {
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
  }, []);

  async function copyEarnLink() {
    try {
      await navigator.clipboard.writeText(earnUrl);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    copyResetRef.current = setTimeout(() => setCopyState("idle"), 2200);
  }

  return (
    <div className={`panel-join-menu ${open ? "open" : ""}`} ref={rootRef}>
      <UiButton
        type="button"
        className="panel-join-trigger"
        aria-label="Earn"
        aria-haspopup="dialog"
        aria-controls={menuId}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Share2 size={15} />
        <span>Earn</span>
        <ChevronDown className="panel-join-chevron" size={13} />
      </UiButton>
      {open && (
        <UiDialogPanel className="panel-join-popover" id={menuId} role="dialog" aria-label="Earn by contributing">
          <strong className="panel-join-heading">Contribute</strong>
          <div className="panel-join-options">
            <UiLink href={browserUrl} {...externalProps} onClick={() => setOpen(false)}>
              <Globe2 size={17} /><span>In your browser</span><ChevronRight size={14} />
            </UiLink>
            <UiLink href={downloadsUrl} {...externalProps} onClick={() => setOpen(false)}>
              <Download size={17} /><span>On your computer</span><ChevronRight size={14} />
            </UiLink>
            <UiButton type="button" onClick={() => { setOpen(false); onOpenEarn(); }}>
              <Network size={17} /><span>All options</span><ChevronRight size={14} />
            </UiButton>
          </div>
          <UiButton type="button" className={`panel-join-copy ${copyState}`} onClick={() => void copyEarnLink()} aria-live="polite">
            {copyState === "copied" ? <Check size={16} /> : <Copy size={16} />}
            {copyState === "copied" ? "Link copied" : copyState === "error" ? "Try copying again" : "Copy invite link"}
          </UiButton>
        </UiDialogPanel>
      )}
    </div>
  );
}

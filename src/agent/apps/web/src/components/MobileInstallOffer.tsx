import { Trans, useLingui } from "@lingui/react/macro";
import { productBrand } from "@rakazo/contracts/product-brand";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ToggleGroup,
  ToggleGroupItem,
} from "@rakazo/ui-web";
import { Check, Copy, Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";
import { appPath } from "../lib/app-path";
import { IconTooltip } from "./IconTooltip";

const DISMISSED_KEY = "mycellios.mobile-install-offer.dismissed.v1";
export const MOBILE_INSTALL_URL = new URL("/agent/", productBrand.apiBaseUrl).href;

/** Share the active server, never a private chat URL, token or loopback preview. */
export function mobileInstallUrl(origin: string, base = import.meta.env.BASE_URL) {
  const url = new URL(origin);
  if (
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.hostname.endsWith(".localhost")
  )
    return MOBILE_INSTALL_URL;
  return new URL(appPath("/", base), url.origin).href;
}

function dismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function appleDevice() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function installedMobile() {
  const mobile = appleDevice() || /Android/.test(navigator.userAgent);
  return (
    mobile &&
    (window.matchMedia?.("(display-mode: standalone)").matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

/** A dismissible invitation, separate from native Desktop downloads and updates. */
export function MobileInstallOffer({
  mini = false,
  showOffer = true,
  open,
  onOpenChange,
}: {
  mini?: boolean;
  showOffer?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const mobileUrl = mobileInstallUrl(location.origin);
  const [hidden, setHidden] = useState(dismissed);
  const [installed, setInstalled] = useState(installedMobile);
  const [platform, setPlatform] = useState(appleDevice() ? "ios" : "android");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    const media = window.matchMedia?.("(display-mode: standalone)");
    const changed = () => setInstalled(installedMobile());
    const installedHere = () => {
      if (appleDevice() || /Android/.test(navigator.userAgent)) setInstalled(true);
    };
    media?.addEventListener("change", changed);
    window.addEventListener("appinstalled", installedHere);
    return () => {
      media?.removeEventListener("change", changed);
      window.removeEventListener("appinstalled", installedHere);
    };
  }, []);
  useEffect(() => {
    if (!open) setCopyState("idle");
  }, [open]);
  function dismiss() {
    setHidden(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* Hide for this visit. */
    }
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(mobileUrl);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }
  return (
    <>
      {showOffer &&
        !hidden &&
        !installed &&
        (mini ? (
          <div className="shrink-0 px-1 pt-1">
            <IconTooltip label={t`Mycellios on your phone`}>
              <Button
                variant="ghost"
                size="icon-lg"
                aria-label={t`Mycellios on your phone`}
                onClick={() => onOpenChange(true)}
              >
                <Smartphone aria-hidden="true" />
              </Button>
            </IconTooltip>
          </div>
        ) : (
          <section
            aria-label={t`Mycellios for mobile`}
            data-testid="mobile-install-offer"
            className="relative mx-2.5 mt-2 shrink-0 rounded-xl border border-border bg-sidebar-accent p-3"
          >
            <div className="flex min-w-0 items-center gap-2 pe-7">
              <Smartphone className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <h2 className="min-w-0 text-xs font-medium text-foreground">
                <Trans>Mycellios for mobile</Trans>
              </h2>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute end-1 top-1"
              aria-label={t`Dismiss mobile invitation`}
              onClick={dismiss}
            >
              <X className="size-3.5" aria-hidden="true" />
            </Button>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              <Trans>Add Mycellios to your Home Screen on iPhone or Android.</Trans>
            </p>
            <Button
              variant="secondary"
              className="mt-2 h-auto min-h-8 w-full whitespace-normal text-xs"
              onClick={() => onOpenChange(true)}
            >
              <Trans>How to install</Trans>
            </Button>
          </section>
        ))}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              <Trans>Mycellios on your phone</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>Use your same account and Micos. Add the web app to your Home Screen.</Trans>
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border px-3 py-2">
            <a
              href={mobileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 break-all text-sm underline underline-offset-4"
            >
              {mobileUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </a>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Copy mobile link`}
              onClick={() => void copyLink()}
            >
              {copyState === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            </Button>
          </div>
          {copyState !== "idle" && (
            <p role="status" className="text-xs text-muted-foreground">
              {copyState === "copied"
                ? t`Link copied`
                : t`Could not copy. Open the link above or type it on your phone.`}
            </p>
          )}
          <ToggleGroup
            aria-label={t`Phone type`}
            value={[platform]}
            onValueChange={([value]) => {
              if (value) setPlatform(value);
            }}
            className="grid grid-cols-2 rounded-lg bg-muted p-1"
          >
            <ToggleGroupItem
              value="ios"
              className="aria-pressed:bg-background aria-pressed:shadow-sm"
            >
              iPhone / iPad
            </ToggleGroupItem>
            <ToggleGroupItem
              value="android"
              className="aria-pressed:bg-background aria-pressed:shadow-sm"
            >
              Android
            </ToggleGroupItem>
          </ToggleGroup>
          <ol className="list-decimal space-y-3 ps-5 text-sm leading-relaxed">
            {platform === "ios" ? (
              <>
                <li>
                  <Trans>Open the link in Safari on your iPhone or iPad.</Trans>
                </li>
                <li>
                  <Trans>
                    Tap Share, then Add to Home Screen. You may find Share inside the page menu.
                  </Trans>
                </li>
                <li>
                  <Trans>Keep Open as Web App enabled if shown, then tap Add.</Trans>
                </li>
              </>
            ) : (
              <>
                <li>
                  <Trans>Open the link in Chrome on your Android phone.</Trans>
                </li>
                <li>
                  <Trans>
                    Open the three-dot menu and choose Install and create shortcut, then Install. It
                    may appear as Add to Home Screen.
                  </Trans>
                </li>
                <li>
                  <Trans>Confirm, then open Mycellios from your Home Screen.</Trans>
                </li>
              </>
            )}
          </ol>
          <p className="text-xs leading-relaxed text-muted-foreground">
            <Trans>
              No store download is needed. Micos that work on your computer still need that computer
              to stay on.
            </Trans>
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

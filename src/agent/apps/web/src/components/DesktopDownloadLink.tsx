import { useLingui } from "@lingui/react/macro";
import { productBrand } from "@rakazo/contracts";
import { buttonVariants } from "@rakazo/ui-web";
import { Download } from "lucide-react";
import { desktopBridge } from "../lib/desktop";

/** Web/PWA entry point; separate from contribution and never replaces the chat. */
export function DesktopDownloadLink({ mini = false }: { mini?: boolean }) {
  const { t } = useLingui();
  if (desktopBridge()) return null;
  const label = t`Get Mycellios Desktop`;
  return <div className={`shrink-0 ${mini ? "px-1 pt-1" : "px-2.5 pt-1"}`}>
    <a data-testid="desktop-download-offer"
      href={new URL("/downloads/desktop", productBrand.apiBaseUrl).href}
      target="_blank" rel="noopener noreferrer" aria-label={label} title={mini ? label : undefined}
      className={buttonVariants({ variant: "ghost", className: `min-h-11 w-full gap-2 text-xs font-normal whitespace-normal ${mini ? "justify-center px-1" : "justify-start px-2.5 text-left"}` })}>
      <Download className="size-4 shrink-0" aria-hidden="true" />
      {!mini && <span className="min-w-0 break-words">{label}</span>}
    </a>
  </div>;
}

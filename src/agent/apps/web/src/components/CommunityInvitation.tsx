import { useLingui } from "@lingui/react/macro";
import { productBrand } from "@rakazo/contracts";
import { Button, buttonVariants } from "@rakazo/ui-web";
import { MessagesSquare, X } from "lucide-react";
import { useState } from "react";

const dismissedKey = "mycellios.community-invitation.dismissed";

export function CommunityInvitation({ mini = false }: { mini?: boolean }) {
  const { t } = useLingui();
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(dismissedKey) === "1"; } catch { return false; }
  });
  if (hidden || mini) return null;

  function dismiss() {
    setHidden(true);
    try { localStorage.setItem(dismissedKey, "1"); } catch { /* Hide for this visit. */ }
  }

  return <section aria-label={t`Mycellios community`}
    className="relative mx-2.5 mt-2 shrink-0 rounded-xl bg-sidebar-accent p-3">
    <div className="flex min-w-0 items-center gap-2 pe-7">
      <MessagesSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-xs font-medium text-foreground">{t`Make yourself at home.`}</h2>
    </div>
    <Button variant="ghost" size="icon-sm" className="absolute end-1 top-1"
      aria-label={t`Dismiss community invitation`} onClick={dismiss}>
      <X className="size-3.5" aria-hidden="true" />
    </Button>
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
      {t`Share ideas and follow Mycellios on Discord and X.`}
    </p>
    <div className="mt-2 flex min-w-0 gap-2">
      <a href={productBrand.communityDiscordUrl} target="_blank" rel="noopener noreferrer"
        className={buttonVariants({ variant: "secondary", className: "min-h-9 min-w-0 flex-1 gap-2 whitespace-normal px-2 text-xs" })}>
        <MessagesSquare className="size-4 shrink-0" aria-hidden="true" />
        <span>{t`Open Discord`}</span>
      </a>
      <a href={productBrand.communityXUrl} target="_blank" rel="noopener noreferrer"
        aria-label={t`Follow Mycellios on X`} title={t`Follow Mycellios on X`}
        className={buttonVariants({ variant: "secondary", className: "size-9 shrink-0 p-2.5" })}>
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className="size-4">
          <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.22-6.82-5.96 6.82H1.68l7.73-8.84L1.25 2.25h6.82l4.71 6.23 5.46-6.23Zm-1.16 17.52h1.83L7.01 4.13H5.05l12.03 15.64Z" />
        </svg>
      </a>
    </div>
  </section>;
}

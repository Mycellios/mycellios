import { Trans } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { Link, useNavigate } from "react-router-dom";
import { Mico, MycelliosWordmark } from "../components/MycelliosBrand";
import { desktopDragClass } from "../lib/desktop";
import { WindowChrome } from "./WindowChrome";

export function WelcomePage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-full flex-col bg-background" data-rakazo-surface="welcome">
      <header className={`${desktopDragClass()} flex items-center justify-between gap-4 px-6 py-5 sm:px-10`}>
        <MycelliosWordmark />
        <WindowChrome />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
        <Mico size={192} className="mb-5 size-40 sm:size-48" />
        <p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Mycellios Agent
        </p>
        <h1 className="max-w-xl font-display text-4xl leading-tight tracking-tight sm:text-5xl">
          <Trans>A little help. A lot of possibility.</Trans>
        </h1>
        <p className="mt-5 max-w-sm text-base leading-relaxed text-muted-foreground">
          <Trans>Meet your Micos: assistants to think, create, and get things done.</Trans>
        </p>
        <div className="mt-9 flex items-center justify-center gap-3">
          <Button
            onClick={() => navigate("/sign-up")}
            className="app-no-drag h-11 rounded-full px-7"
          >
            <Trans>Get started</Trans>
            <span aria-hidden="true">→</span>
          </Button>
          <Link
            to="/sign-in"
            className="app-no-drag rounded-full px-5 py-3 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Trans>Sign in</Trans>
          </Link>
        </div>
      </main>
    </div>
  );
}

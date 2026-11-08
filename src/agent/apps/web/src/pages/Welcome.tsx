import { Trans } from "@lingui/react/macro";
import { productBrand } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { Link, useNavigate } from "react-router-dom";
import { BrandLaunch } from "../components/BrandLaunch";
import { appPath } from "../lib/app-path";
import { WindowChrome } from "./WindowChrome";

export function WelcomePage() {
  const navigate = useNavigate();
  return (
    <BrandLaunch
      drag
      surface="welcome"
      markSrc={appPath(productBrand.mascotPath)}
      animatedSrc={appPath(productBrand.mascotAnimationPath)}
      wordSrc={appPath(productBrand.markPath)}
      alt={productBrand.companionName}
      toolbar={<WindowChrome />}
    >
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
    </BrandLaunch>
  );
}

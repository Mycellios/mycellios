import { productBrand } from "@rakazo/contracts";
import { appPath } from "../lib/app-path";
import { BrandLaunch } from "./BrandLaunch";

export function StartupScreen({ state }: { state: "session-pending" | "i18n-pending" }) {
  return (
    <BrandLaunch
      documentFrame
      busy
      appState={state}
      markSrc={appPath(productBrand.mascotPath)}
      wordSrc={appPath(productBrand.markPath)}
    />
  );
}

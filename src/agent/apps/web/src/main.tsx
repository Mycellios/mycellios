import { installFocusInput } from "./lib/focus-input";
import { syncNativeLogo } from "./lib/logo-preference";
import { installActionSounds } from "./lib/reply-sound";
import "./lib/i18n";
import { applyGeneralPreferences, subscribeGeneralPreferences } from "./lib/general-preferences";
import { installAndroidHost, isAndroidHost } from "./lib/android-host";
import "./monitoring-bootstrap";
import "./lib/native-pc-bootstrap";
import { Toaster, TooltipProvider } from "@rakazo/ui-web";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router-dom";
import { App } from "./App";
import { DesktopUpdatesProvider } from "./components/DesktopUpdates";
import { I18nBootstrap } from "./components/I18nBootstrap";
import { WebUpdates } from "./components/WebUpdates";
import { applyUiDirection } from "./lib/apply-ui-direction";
import { appBasePath } from "./lib/app-path";
import { clientUpdates } from "./lib/client-update";
import { reportCaughtReactError } from "./lib/monitoring";
import { markAfterPaint, markOnce } from "./lib/performance";
import { installPreloadRecovery } from "./lib/preload-recovery";
import { queryClient } from "./lib/query";
import { applyInterfaceSize } from "./lib/interface-size";
import { applyUiAppearance, watchSystemAppearance } from "./lib/ui-appearance";
import { resolveUiLocale } from "./lib/ui-locale";
import { registerServiceWorker } from "./pwa/register";
import "./styles.css";

markOnce("rk:renderer:module-evaluated");
installPreloadRecovery();
const removeFocusInput = installFocusInput();
import.meta.hot?.dispose(removeFocusInput);
installAndroidHost();
if (!isAndroidHost()) { clientUpdates().install(); registerServiceWorker(); }
applyUiDirection(resolveUiLocale());
applyUiAppearance();
applyInterfaceSize();
applyGeneralPreferences();
installActionSounds();
void syncNativeLogo().catch(() => undefined);
subscribeGeneralPreferences(() => { void syncNativeLogo().catch(() => undefined); });

function PerformanceProbe() {
  useLayoutEffect(() => {
    markOnce("rk:renderer:first-react-commit");
    markAfterPaint("rk:renderer:first-react-painted");
  }, []);
  return null;
}

/** A route change is a safe moment to move onto a newer deployment. */
function ClientUpdateOnNavigate() {
  const { pathname } = useLocation();
  const previous = useRef(pathname);
  useEffect(() => {
    if (pathname === previous.current) return;
    previous.current = pathname;
    clientUpdates().navigated();
  }, [pathname]);
  return null;
}

function AppearanceSync() {
  useEffect(() => watchSystemAppearance(), []);
  return null;
}

createRoot(document.getElementById("root")!, { onCaughtError: reportCaughtReactError }).render(
  <StrictMode>
    <PerformanceProbe />
    <AppearanceSync />
    <I18nBootstrap>
      {/* Router state updates must not be transitions: under sustained urgent
          updates (SSE churn while a run streams) a pending navigation is
          preempted indefinitely — useSearchParams/useParams then keep serving
          the stale location, so deep links (?m=) and thread switches never
          land while the URL already moved. */}
      <BrowserRouter basename={appBasePath()} useTransitions={false}>
        <ClientUpdateOnNavigate />
        <QueryClientProvider client={queryClient}>
          <DesktopUpdatesProvider>
            <TooltipProvider>
              <App />
            </TooltipProvider>
            <Toaster />
            <WebUpdates />
          </DesktopUpdatesProvider>
        </QueryClientProvider>
      </BrowserRouter>
    </I18nBootstrap>
  </StrictMode>,
);


import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { PageLoading } from "../../components/PageLoading";
import { guestApi, guestChatEligible, isGuestEntry, type GuestConfig } from "../../lib/guest-chat";
import { activateGuestMode, guestModeActive } from "../../lib/guest-mode";
import { ensureGuestLock } from "../../lib/guest-lock";
import { GuestAccountPrompt } from "./GuestAccountPrompt";

/** The shell routes a guest may open: the Agent entry and its one Mico. */
export function guestShellPath(pathname: string): boolean {
  return /^\/app(\/[^/]+)?\/?$/.test(pathname) && !/^\/app\/(artifacts|board|g)\/?$/.test(pathname);
}

/**
 * The Agent entry for a signed-out visitor: when the coordinator enables guest chat for an
 * ordinary browser tab, the ordinary shell (children) in guest mode, backed by the browser-local
 * guest data layer; otherwise the fallback (welcome page or sign-in). Any failure keeps the fallback.
 */
export function GuestEntry({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
  const { pathname, search } = useLocation();
  // Once a guest is in, a query parameter is dropped below instead of leaving guest mode.
  const eligible = guestChatEligible() && (guestModeActive() || isGuestEntry(search));
  const [config, setConfig] = useState<GuestConfig | null | undefined>(eligible ? (guestModeActive() ? cachedConfig : undefined) : null);
  useEffect(() => {
    if (!eligible) { setConfig(null); return; }
    // Reused only while the visitor stays in guest mode; after leaving it, the coordinator is asked again.
    if (cachedConfig && guestModeActive()) { setConfig(cachedConfig); return; }
    let current = true;
    guestApi.config().then(value => {
      if (value.enabled) cachedConfig = value;
      if (current) setConfig(value);
    }, () => { if (current) setConfig(null); });
    return () => { current = false; };
  }, [eligible]);
  if (config === undefined) return <PageLoading />;
  if (!config?.enabled) return <>{fallback}</>;
  // Deep links into the shell (?settings=, ?task=, ?view=…) open features that need an account.
  if (!isGuestEntry(search)) return <Navigate to={pathname} replace />;
  // Before the shell's first read, so every request goes to the guest data layer.
  activateGuestMode(config.limits);
  ensureGuestLock();
  return <>
    <div data-guest-shell className="contents">{children}</div>
    <GuestAccountPrompt />
  </>;
}

let cachedConfig: Extract<GuestConfig, { enabled: true }> | undefined;

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { PageLoading } from "../../components/PageLoading";
import { guestApi, guestChatEligible, isGuestEntry, type GuestConfig } from "../../lib/guest-chat";
import { lazyComponent } from "../../lib/preload-recovery";

const GuestChat = lazyComponent(() => import("./GuestChat").then(module => module.GuestChat));

/**
 * The bare Agent entry for a signed-out visitor: guest chat when the coordinator enables it for
 * an ordinary browser tab, otherwise the existing welcome page. Any failure keeps the welcome.
 */
export function GuestEntry({ fallback }: { fallback: ReactNode }) {
  const { search } = useLocation();
  const eligible = guestChatEligible() && isGuestEntry(search);
  const [config, setConfig] = useState<GuestConfig | null | undefined>(eligible ? undefined : null);
  useEffect(() => {
    if (!eligible) { setConfig(null); return; }
    let current = true;
    guestApi.config().then(value => { if (current) setConfig(value); }, () => { if (current) setConfig(null); });
    return () => { current = false; };
  }, [eligible]);
  if (config === undefined) return <PageLoading />;
  if (!config?.enabled) return <>{fallback}</>;
  return <Suspense fallback={<PageLoading />}><GuestChat limits={config.limits} /></Suspense>;
}

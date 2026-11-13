import { MICO_PRIMARY_AVATAR } from "@rakazo/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { BotAvatar, Button } from "@rakazo/ui-web";
import { Check, Copy, Laptop, LoaderCircle, Smartphone, Tablet } from "lucide-react";
import { demoApi, type EventDemoNetwork } from "../../lib/event-demo";
import { ServerLinkCode } from "../../components/ServerLinkCode";

export function DemoPresenter({ id }: { id: string }) {
  const { t } = useLingui();
  const api = useMemo(() => demoApi(id), [id]);
  const secret = useRef(new URLSearchParams(window.location.hash.slice(1)).get("view") ?? "");
  const [network, setNetwork] = useState<EventDemoNetwork | null>(null), [failed, setFailed] = useState(false), [copied, setCopied] = useState(false);
  useEffect(() => {
    let stopped = false, busy = false;
    const refresh = async () => {
      if (busy || !secret.current) { if (!secret.current) setFailed(true); return; }
      busy = true;
      try {
        const result = await api.network(secret.current);
        if (!stopped) { setNetwork(result); setFailed(false); }
      } catch { if (!stopped) setFailed(true); }
      finally { busy = false; }
    };
    void refresh(); const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [api]);
  const devices = network?.open && !failed ? network.devices.filter(device => device.present || device.connected || device.working) : [];
  return <main className="event-demo event-demo-presenter">
    <header className="event-demo-header"><div className="event-demo-brand"><BotAvatar color={MICO_PRIMARY_AVATAR} size={34} /><span>Mycellios</span></div>
      <span className="event-demo-live" data-online={!failed && Boolean(network)}><span />{failed ? t`Connection interrupted` : t`Live`}</span></header>
    <div className="event-demo-stage">
      <section className="event-demo-network"><div className="event-demo-network-heading"><h1>{t`A network built together.`}</h1>
        <p>{t`Scan. Ask Mico. Press Play to join the network.`}</p></div>
        {!network ? <div className="event-demo-empty" role={failed ? "alert" : "status"}>
          {failed ? t`Open your presenter link to see this event.` : <><LoaderCircle className="animate-spin motion-reduce:animate-none" />{t`Connecting…`}</>}</div>
          : <><dl className="event-demo-stats"><div><dt>{t`Connected now`}</dt><dd data-testid="demo-present-count">{failed ? "—" : devices.length}</dd></div>
            <div><dt>{t`Generating AI`}</dt><dd data-testid="demo-compute-count">{failed ? "—" : network.connected}</dd></div>
            <div><dt>{t`Verified inference`}</dt><dd>{network.inferences}</dd></div></dl>
            {!network.open && <p className="event-demo-notice">{t`This event is closed.`}</p>}
            {failed && <p className="event-demo-notice" role="status">{t`Live status is unavailable. Reconnecting…`}</p>}
            <div className="event-demo-devices" aria-label={t`Event devices`} aria-live="polite">
              {!failed && !devices.length && <div className="event-demo-empty"><BotAvatar color={MICO_PRIMARY_AVATAR} size={78} /><p>{t`No one is connected right now.`}</p></div>}
              {devices.map(device => {
                const Icon = device.kind === "mobile" ? Smartphone : device.kind === "tablet" ? Tablet : Laptop;
                const state = device.working ? t`Running inference` : device.connected ? t`Available for inference` : t`In the app`;
                return <div className="event-demo-device" data-present="true" data-connected={device.connected} data-working={device.working} key={device.number} title={state}>
                  <span className="event-demo-device-glyph"><Icon size={30} strokeWidth={1.5} /><i /></span>
                  <span>{t`Guest`} {String(device.number).padStart(2, "0")}</span><small>{state}</small>
                </div>;
              })}
            </div>
            <footer className="event-demo-network-footer"><span>{t`Earned by verified work`}: {(network.earnedMicrounits / 1_000_000).toLocaleString("es-ES", { maximumFractionDigits: 6 })} {t`credits`}</span>
              <time dateTime={new Date(network.at).toISOString()}>{t`Updated`} {new Date(network.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></footer>
          </>}
      </section>
      <aside className="event-demo-join"><h2>{t`Try Mycellios`}</h2><p>{t`Your own Mico. No registration.`}</p>
        {network && <><ServerLinkCode url={network.inviteUrl} /><Button variant="outline" onClick={() => {
          void navigator.clipboard.writeText(network.inviteUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => undefined);
        }}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? t`Copied` : t`Copy invitation`}</Button>
          <p className="event-demo-grant">{t`0.20 credits per guest`}<small>{t`First 50 guests · 48 hours`}</small></p>
          <p className="event-demo-privacy">{t`Private chats stay off this screen. Connected devices and real verified work only.`}</p></>}
      </aside>
    </div>
  </main>;
}

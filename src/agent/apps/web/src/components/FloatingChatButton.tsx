import { useLingui } from "@lingui/react/macro";
import { Button } from "@mycellios/ui-web";
import { ExternalLink, PanelsTopLeft } from "lucide-react";
import { useState } from "react";
import { desktopBridge } from "../lib/desktop";

/** `inMenu`: a labelled row in Chat tools, which then closes. Without it, the header icon. */
export function FloatingChatButton({ userId, spaceId, botId, inMenu = false, onOpened }: {
  userId?: string; spaceId: string | null; botId?: string; inMenu?: boolean; onOpened?: () => void;
}) {
  const { t } = useLingui();
  const desktop = desktopBridge();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const floating = desktop?.chatWindow;
  if (!floating && (!desktop?.companions?.openChat || !userId || !spaceId || !botId)) return null;
  const label = floating ? t`Open in main window` : t`Open floating chat`;
  async function open() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      if (floating) await floating.returnToMain();
      else await desktop!.companions!.openChat!({ scope: JSON.stringify([userId, spaceId]), botId: botId! });
      onOpened?.();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  if (inMenu) return <>
    <Button variant="ghost" data-mobile-chat-action disabled={busy} onClick={() => void open()}>
      {floating ? <PanelsTopLeft size={16} aria-hidden /> : <ExternalLink size={16} aria-hidden />}{label}
    </Button>
    {failed && <p role="alert" className="px-3 text-xs text-destructive">{t`Could not open the chat window. Try again.`}</p>}
  </>;
  return <span className="flex min-w-0 items-center gap-2">
    {/* Same plain icon button as the other header actions, without a frame of its own. */}
    <Button size="icon-sm" variant="ghost" disabled={busy} aria-label={label} title={label}
      className="app-no-drag" onClick={() => void open()}>
      {floating ? <PanelsTopLeft size={16} /> : <ExternalLink size={16} />}
    </Button>
    {failed && <span role="alert" className="max-w-40 text-xs text-destructive">{t`Could not open the chat window. Try again.`}</span>}
  </span>;
}

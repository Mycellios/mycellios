import { useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { ExternalLink, PanelsTopLeft } from "lucide-react";
import { useState } from "react";
import { desktopBridge } from "../lib/desktop";

export function FloatingChatButton({ userId, spaceId, botId }: {
  userId?: string; spaceId: string | null; botId?: string;
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
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return <span className="flex min-w-0 items-center gap-2">
    <Button size="icon-lg" variant="floating" disabled={busy} aria-label={label} title={label}
      className="app-no-drag rk-chat-action" onClick={() => void open()}>
      {floating ? <PanelsTopLeft size={18} /> : <ExternalLink size={18} />}
    </Button>
    {failed && <span role="alert" className="max-w-40 text-xs text-destructive">{t`Could not open the chat window. Try again.`}</span>}
  </span>;
}

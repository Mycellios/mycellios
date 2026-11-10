import { useLingui } from "@lingui/react/macro";
import { BotAvatar, Button, Dialog, DialogContent, DialogTitle, DialogDescription } from "@rakazo/ui-web";
import { MessageCirclePlus } from "lucide-react";
import { useRef, useState } from "react";
import { useSpaceRpc } from "../../lib/space-rpc";
import { newClientId } from "../../lib/client-id";
import { errorText } from "../../lib/user-error";

export function NewChatControl({ botId, name, color, disabled, onStarted }: {
  botId: string; name: string; color?: string; disabled?: boolean; onStarted?: () => void;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nonce = useRef<string | null>(null), pending = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null), trigger = useRef<HTMLButtonElement>(null);
  async function start() {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); setError(null);
    nonce.current ??= newClientId();
    try {
      await rpc.threads.newChat({ botId, clientNonce: nonce.current });
      nonce.current = null; setOpen(false); onStarted?.();
    } catch (err) { setError(errorText(err, t`Could not start a new chat. Try again.`)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <>
    <Button ref={trigger} type="button" variant="ghost" size="icon"
      data-testid="composer-new-chat" aria-label={t`New chat`} title={t`New chat`} disabled={disabled}
      className="size-10 shrink-0 rounded-full bg-muted text-muted-foreground hover:bg-accent hover:text-foreground md:size-7"
      onClick={() => { setError(null); setOpen(true); }}><MessageCirclePlus size={16} aria-hidden /></Button>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) { setOpen(value); setError(null); } }}>
      <DialogContent initialFocus={cancel} finalFocus={trigger} showCloseButton={false}
        className="w-[460px] gap-0 overflow-hidden rounded-[20px] p-0 sm:max-w-[460px] dark:bg-[#191919]">
        <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-4 p-7">
          <div className="row-span-2"><BotAvatar color={color ?? ""} size={44}/></div>
          <DialogTitle className="text-base font-semibold leading-5">{t`Start a new chat with ${name}?`}</DialogTitle>
          <DialogDescription className="mt-2 text-[15px] leading-5 text-muted-foreground">{t`The Mico forgets this chat. Messages remain visible above a divider. Instructions, model, tools, memories, workspace and browser stay the same.`}</DialogDescription>
          {error ? <p role="alert" className="col-start-2 mt-3 text-sm text-destructive">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-3 border-t px-6 py-4">
          <Button ref={cancel} variant="ghost" className="h-9 rounded-[8px] text-muted-foreground" disabled={busy} onClick={() => { setOpen(false); setError(null); }}>{t`Cancel`}</Button>
          <Button className="h-9 rounded-[8px] bg-foreground text-background hover:bg-foreground/85 hover:text-background" disabled={busy || disabled} onClick={() => void start()}>{busy ? t`Starting…` : t`Start new chat`}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}

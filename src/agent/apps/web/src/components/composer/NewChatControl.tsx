import { Trans, useLingui } from "@lingui/react/macro";
import { BotAvatar, Button, Dialog, DialogContent, DialogTitle, DialogDescription, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, toast } from "@mycellios/ui-web";
import { Minimize2, MoreHorizontal, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import { useBoundTaskThreadScope, useSpaceRpc } from "../../lib/space-rpc";
import { newClientId } from "../../lib/client-id";
import { errorText } from "../../lib/user-error";

export function NewChatControl({ botId, name, color, disabled, canCompact, onStarted }: {
  botId: string; name: string; color?: string; disabled?: boolean; canCompact?: boolean; onStarted?: () => void;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const taskScope = useBoundTaskThreadScope();
  const [action, setAction] = useState<"reset" | "compact" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nonce = useRef<string | null>(null), pending = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null), trigger = useRef<HTMLButtonElement>(null);
  async function start() {
    if (pending.current || disabled || !action) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      if (action === "compact") {
        const result = await rpc.threads.compactContext({ botId, taskThreadId: taskScope?.taskThreadId });
        toast.info(result.queued ? t`Context compaction requested.` : t`There are no older messages to compact yet.`);
      } else {
        nonce.current ??= newClientId();
        await rpc.threads.newChat({ botId, clientNonce: nonce.current });
        nonce.current = null;
        onStarted?.();
      }
      setAction(null);
    } catch (err) {
      setError(errorText(err, action === "compact" ? t`Could not request compaction. Try again.` : t`Could not reset the context. Try again.`));
    }
    finally { pending.current = false; setBusy(false); }
  }
  // This endpoint resets the main chat only. Never offer it from a task thread.
  if (taskScope && !canCompact) return null;
  const compact = action === "compact";
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button ref={trigger} type="button" variant="ghost" size="icon"
        data-testid="composer-context-options" aria-label={t`Conversation options`} title={t`Conversation options`} disabled={disabled}
        className="size-10 shrink-0 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground md:size-7" />}>
        <MoreHorizontal size={16} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canCompact ? <DropdownMenuItem onClick={() => setAction("compact")}><Minimize2 size={14} aria-hidden /><span><Trans>Compact now…</Trans></span></DropdownMenuItem> : null}
        {!taskScope ? <DropdownMenuItem onClick={() => setAction("reset")}><RotateCcw size={14} aria-hidden /><span><Trans>Reset context…</Trans></span></DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={action !== null} onOpenChange={(value) => { if (!value && !busy) { setAction(null); setError(null); } }}>
      <DialogContent initialFocus={cancel} finalFocus={trigger} showCloseButton={false}
        className="w-[calc(100%-2rem)] max-w-[460px] gap-0 overflow-hidden rounded-[20px] p-0 dark:bg-[#191919]">
        <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-4 p-7">
          <div className="row-span-2"><BotAvatar color={color ?? ""} size={44}/></div>
          <DialogTitle className="text-base font-semibold leading-5">{compact ? t`Compact this conversation?` : t`Reset ${name}'s main chat context?`}</DialogTitle>
          <DialogDescription className="mt-2 text-[15px] leading-5 text-muted-foreground">{compact
            ? <Trans>Summarize older messages for future replies. All messages stay visible. This uses a model call and may spend Credits.</Trans>
            : <Trans>Previous messages stay visible. The Mico keeps its memories, instructions and tools. To work on another task, choose New conversation.</Trans>}
          </DialogDescription>
          {error ? <p role="alert" className="col-start-2 mt-3 text-sm text-destructive">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-3 border-t px-6 py-4">
          <Button ref={cancel} variant="ghost" className="h-9 rounded-[8px] text-muted-foreground" disabled={busy} onClick={() => { setAction(null); setError(null); }}>{t`Cancel`}</Button>
          <Button className="h-9 rounded-[8px] bg-foreground text-background hover:bg-foreground/85 hover:text-background" disabled={busy || disabled} onClick={() => void start()}>{compact ? (busy ? t`Requesting…` : t`Compact now`) : (busy ? t`Resetting…` : t`Reset context`)}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}

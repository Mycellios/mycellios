import { MICO_AVATAR_PALETTES, MICO_AVATAR_SHAPES, micoAvatarValue } from "@rakazo/contracts";
import {
  BotAvatar,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Input,
} from "@rakazo/ui-web";
import { Check, Copy, Gift } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSpaceRpc } from "../lib/space-rpc";
import { IconTooltip } from "./IconTooltip";

const mascots = [
  { shape: MICO_AVATAR_SHAPES[1], palette: MICO_AVATAR_PALETTES[1], size: 37 },
  { shape: MICO_AVATAR_SHAPES[0], palette: MICO_AVATAR_PALETTES[0], size: 53 },
  { shape: MICO_AVATAR_SHAPES[3], palette: MICO_AVATAR_PALETTES[3], size: 39 },
];

export function InviteFriends({ inMenu = false, className, userId }: { inMenu?: boolean; className?: string; userId?: string | null }) {
  const rpc = useSpaceRpc();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [invite, setInvite] = useState<{ link: string; rewardMicrounits: number; rewardDays: number; rewardedInvites: number } | null>(null);
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const linkRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setInvite(null); setError("");
    if (!open) return;
    if (!userId) { setLoading(false); setError("Inicia sesión con tu cuenta Mycellios para invitar amigos."); return; }
    let alive = true;
    const abort = new AbortController();
    setLoading(true);
    void rpc.referrals.invite({ expectedUserId: userId }, { signal: abort.signal }).then(value => {
      if (alive) setInvite(value);
    }).catch(() => { if (alive) setError("El programa de referidos todavía no está disponible para esta sesión. Inicia sesión con tu cuenta Mycellios verificada o vuelve a intentarlo."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; abort.abort(); };
  }, [open, userId, rpc, attempt]);

  async function copyLink() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.link);
      setCopyState("copied");
    } catch {
      linkRef.current?.focus();
      linkRef.current?.select();
      setCopyState("manual");
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => { setOpen(next); setCopyState("idle"); }}>
      <IconTooltip label="Invitar amigos">
        <DialogTrigger
          render={<Button variant={inMenu || className ? "ghost" : "floating"} size="icon-lg" className={`app-no-drag ${className ?? ""}`} data-mobile-chat-action={inMenu || undefined} />}
          aria-label="Invitar amigos"
        >
          <Gift size={18} strokeWidth={1.75} aria-hidden="true" />
          {inMenu ? "Invitar amigos" : null}
        </DialogTrigger>
      </IconTooltip>
      <DialogContent className="sm:max-w-md">
        <div className="flex h-16 items-center justify-center gap-3" aria-hidden="true">
          {mascots.map(({ shape, palette, size }) => (
            <BotAvatar
              key={shape.id}
              identity={`invite-${shape.id}`}
              color={micoAvatarValue(shape.index, palette.color)}
              size={size}
            />
          ))}
        </div>
        <div className="space-y-2 text-center">
          <DialogTitle>Invita a tus amigos a Mycellios</DialogTitle>
          <DialogDescription>
            Comparte tu enlace personal. Cuando tu amigo cree y verifique una cuenta nueva, ambos recibís el regalo.
          </DialogDescription>
        </div>
        {invite ? (
          <div className="flex items-start gap-3 rounded-lg bg-muted px-3 py-2.5">
            <Gift size={17} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <p>1 crédito promocional para cada uno</p>
              <p className="text-xs text-muted-foreground">Caduca a los 14 días. Una recompensa por cada cuenta nueva verificada.</p>
              {invite.rewardedInvites > 0 ? <p className="mt-1 text-xs text-muted-foreground">Invitaciones premiadas: {invite.rewardedInvites}</p> : null}
            </div>
          </div>
        ) : null}
        {loading ? <p role="status" className="text-center text-sm text-muted-foreground">Preparando tu enlace personal…</p> : null}
        {error ? <div className="space-y-2 text-center"><p role="status" className="text-sm text-muted-foreground">{error}</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Reintentar</Button></div> : null}
        {invite ? <div className="space-y-2">
          <Input
            ref={linkRef}
            aria-label="Enlace de invitación"
            readOnly
            value={invite.link}
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button className="w-full" onClick={() => void copyLink()}>
            {copyState === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copyState === "copied" ? "Enlace copiado" : "Copiar enlace"}
          </Button>
          {copyState !== "idle" ? (
            <p role="status" className="text-center text-xs text-muted-foreground">
              {copyState === "copied" ? "Ya puedes compartirlo." : "Selecciona y copia el enlace manualmente."}
            </p>
          ) : null}
        </div> : null}
      </DialogContent>
    </Dialog>
  );
}

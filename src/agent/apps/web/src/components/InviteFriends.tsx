import { MICO_AVATAR_PALETTES, MICO_AVATAR_SHAPES, micoAvatarValue } from "@rakazo/contracts";
import { productBrand } from "@rakazo/contracts/product-brand";
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
import { useRef, useState } from "react";
import { appPath } from "../lib/app-path";
import { IconTooltip } from "./IconTooltip";

const publicSignUp = new URL("/agent/sign-up", productBrand.apiBaseUrl).href;
const mascots = [
  { shape: MICO_AVATAR_SHAPES[1], palette: MICO_AVATAR_PALETTES[1], size: 37 },
  { shape: MICO_AVATAR_SHAPES[0], palette: MICO_AVATAR_PALETTES[0], size: 53 },
  { shape: MICO_AVATAR_SHAPES[3], palette: MICO_AVATAR_PALETTES[3], size: 39 },
];

export function InviteFriends() {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const linkRef = useRef<HTMLInputElement>(null);
  const { protocol, hostname, origin } = window.location;
  const canShareOrigin =
    protocol === "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(hostname) &&
    !hostname.endsWith(".localhost");
  const link = canShareOrigin ? new URL(appPath("/sign-up"), origin).href : publicSignUp;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopyState("copied");
    } catch {
      linkRef.current?.focus();
      linkRef.current?.select();
      setCopyState("manual");
    }
  }

  return (
    <Dialog onOpenChange={() => setCopyState("idle")}>
      <IconTooltip label="Invitar amigos">
        <DialogTrigger
          render={<Button variant="floating" size="icon-lg" className="app-no-drag" />}
          aria-label="Invitar amigos"
        >
          <Gift size={17} strokeWidth={1.6} aria-hidden="true" />
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
            Comparte este enlace para que puedan crear su cuenta y conocer a sus Micos.
          </DialogDescription>
        </div>
        {import.meta.env.DEV ? (
          <div className="flex items-start gap-3 rounded-lg bg-muted px-3 py-2.5">
            <Gift size={17} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="font-medium">2 semanas gratis de modelos Mycellios</p>
              <p className="text-xs text-muted-foreground">Vista previa del regalo. El enlace todavía no lo activa.</p>
            </div>
          </div>
        ) : null}
        <div className="space-y-2">
          <Input
            ref={linkRef}
            aria-label="Enlace de invitación"
            readOnly
            value={link}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}

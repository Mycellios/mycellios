import { MICO_PRIMARY_AVATAR, micoAvatarValue } from "@rakazo/contracts";
import { BotAvatar } from "@rakazo/ui-web";

/** Non-loading brand artwork shares the actual Mico renderer and collection. */
export function AuthMushroom({ variant = "mushroom" }: { variant?: "mycelium" | "mushroom" }) {
  return (
    <div className="flex h-[74px] w-[74px] items-center justify-center rounded-full bg-muted"
      data-mascot={variant} aria-hidden="true">
      <BotAvatar
        color={variant === "mycelium" ? micoAvatarValue(1102, "#3F9F78") : MICO_PRIMARY_AVATAR}
        identity={`brand-${variant}`}
        size={48}
      />
    </div>
  );
}

/** The same mascot without its circular backdrop, for a framed brand tile. */
export function AuthMushroomMark({ size = 48 }: { size?: number }) {
  return <BotAvatar color={MICO_PRIMARY_AVATAR} identity="brand-mushroom" size={size} />;
}

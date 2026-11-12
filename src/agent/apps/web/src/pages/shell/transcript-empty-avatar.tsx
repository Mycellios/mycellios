import { BotAvatar } from "@rakazo/ui-web";
import { AuthMushroom } from "../../components/AuthMushroom";

/** A personal chat uses the same saved appearance as its roster and dock. */
export function TranscriptEmptyAvatar({ bot }: { bot?: { id: string; color: string } }) {
  if (!bot) return <AuthMushroom />;
  return (
    <div className="flex h-[74px] w-[74px] items-center justify-center rounded-full bg-muted" aria-hidden="true">
      <BotAvatar color={bot.color} identity={bot.id} size={48} />
    </div>
  );
}

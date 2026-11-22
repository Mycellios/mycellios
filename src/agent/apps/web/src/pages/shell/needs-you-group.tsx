import { useLingui } from "@lingui/react/macro";
import { BotAvatar } from "@mycellios/ui-web";
import { Hand, MessageCircleQuestion, MessagesSquare } from "lucide-react";
import { useMemo } from "react";
import { type NeedsYouEntry, needsYouEntries, needsYouPath } from "../../lib/needs-you";

type RosterRow = {
  kind: "bot" | "group";
  chat: { id: string; spaceId: string; name: string; color?: string; status?: string; conversations?: { waiting: number } | null };
};

/**
 * "Needs you", at the top of the sidebar only while something waits: Micos whose main chat asks
 * a question or a takeover, and Micos with conversations that wait. Each row leads to the place
 * to answer; the chats also stay where they are in their folders.
 */
export function NeedsYouGroup({ groups, mobile = false, openSpaceChat }: {
  groups: readonly { bots: readonly RosterRow[] }[];
  mobile?: boolean;
  openSpaceChat: (spaceId: string, path: string) => void;
}) {
  const { t } = useLingui();
  const entries = useMemo(() => needsYouEntries([{
    bots: groups.flatMap(group => group.bots.flatMap(row => row.kind === "bot" ? [{
      id: row.chat.id, spaceId: row.chat.spaceId, name: row.chat.name, color: row.chat.color ?? "",
      status: row.chat.status ?? "idle", conversations: row.chat.conversations,
    }] : [])),
  }]), [groups]);
  if (!entries.length) return null;
  const describe = (entry: NeedsYouEntry) => entry.action === "answer" ? t`Waiting for your answer`
    : entry.action === "takeover" ? t`Waiting for you to take over`
    : entry.count > 1 ? t`${entry.count} conversations wait for you` : t`A conversation waits for you`;
  const actionLabel = (entry: NeedsYouEntry) => entry.action === "answer" ? t`Answer`
    : entry.action === "takeover" ? t`Take over` : t`Review`;
  const Icon = (entry: NeedsYouEntry) => entry.action === "answer" ? MessageCircleQuestion : entry.action === "takeover" ? Hand : MessagesSquare;
  return <section data-testid="sidebar-needs-you" aria-label={t`Needs you`} className="flex flex-col gap-0.5 pb-1">
    <h2 className={`px-2.5 pt-3 pb-0.5 ${mobile ? "text-[13px] font-semibold text-muted-foreground" : "text-xs font-medium text-foreground"}`}>{t`Needs you`}</h2>
    {entries.map(entry => {
      const ActionIcon = Icon(entry);
      return <button key={entry.key} type="button" data-needs-you={entry.action} data-needs-you-bot={entry.botId}
        aria-label={`${actionLabel(entry)}: ${entry.name}. ${describe(entry)}`}
        className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 text-start outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ${mobile ? "min-h-12 py-1.5" : "min-h-10 py-1"}`}
        onClick={() => openSpaceChat(entry.spaceId, needsYouPath(entry))}>
        <BotAvatar color={entry.color} identity={entry.botId} size={mobile ? 36 : 28} status={entry.status} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body2 font-medium text-foreground" dir="auto">{entry.name}</span>
          <span className="block truncate text-[11.5px] text-muted-foreground">{describe(entry)}</span>
        </span>
        <span aria-hidden="true" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#94620f] px-2 py-0.5 text-[10.5px] font-medium leading-4 text-white">
          <ActionIcon size={12} strokeWidth={2.2} />{actionLabel(entry)}
        </span>
      </button>;
    })}
  </section>;
}

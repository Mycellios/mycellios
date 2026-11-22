import { createContext } from "react";

export type SendToGroupTarget = { id: string; name: string };

/**
 * "Send to group" on a message in a Mico chat: the person's groups, and opening one with the
 * message text in its composer. Attachments stay behind. Absent where the action does not
 * apply (group chats, side views).
 */
export const SendToGroupContext = createContext<{
  groups: readonly SendToGroupTarget[];
  send: (groupId: string, text: string) => void;
} | null>(null);

/** At most this many groups are listed in the menu, most recently active first. */
export const SEND_TO_GROUP_MENU_LIMIT = 12;

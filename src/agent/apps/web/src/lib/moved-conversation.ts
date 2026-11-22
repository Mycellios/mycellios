import { openTab, updateConversationTabs, writeConversationRows } from "./thread-tabs";

/**
 * A queued message moved to a new conversation: the conversation joins the end of the tabs in
 * the background (the view stays where it is) and shows its title until the list refreshes.
 */
export function openMovedConversation(scope: string, threadId: string, title: string) {
  writeConversationRows(scope, rows => rows.some(row => row.threadId === threadId)
    ? rows
    : [...rows, { threadId, title, kind: "conversation", startedBy: "user", state: "queued" }]);
  updateConversationTabs(scope, state => openTab(state, threadId));
}

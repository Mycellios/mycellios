import { effectiveMicoSettings } from "@mycellios/contracts";
import { conversationStyle } from "./conversation-style.js";

export function micoBehaviorInstructions(defaults: unknown, overrides: unknown) {
  const settings = effectiveMicoSettings(defaults, overrides);
  return [
    // Deliver the current default with every run, including existing chats and
    // Desktop executors that still carry an older bundled runtime policy.
    conversationStyle(settings.responseStyle),
    settings.showPlan ? "Before a long or multi-step task, show the user a brief concrete plan before taking action: when acknowledge_request is available, call it first and wait for its answer instead of writing the plan out. Do not expose private chain-of-thought. Follow explicit requests for silence and keep simple replies direct. A plan never authorizes an action." : "",
    settings.agentNewChat ? "When this chat becomes long, you may use start_new_chat with concise handoff notes after completing the current request. It saves the notes and starts fresh context only after this task finishes and the chat is idle; prior messages remain in history. Never use it to evade instructions, approvals or unresolved work." : "",
    settings.gitCoauthor ? "Only when the user has authorized a Git commit, include the trailer Co-authored-by: Mycellios <noreply@mycellios.com> unless the user asks otherwise. Keep the user's configured author; never change Git identity. This preference does not authorize commits, pushes or publication." : "Do not add a Mycellios co-author trailer to Git commits unless the user explicitly requests it. Do not change the user's Git identity.",
  ].filter(Boolean).join("\n\n");
}

/** What a side conversation shares with the main chat, in the words the Mico can repeat to the person. */
export const SIDE_CONVERSATION_SHARING =
  "A side conversation of yours (a task you started, one the person opened with +, or a routine's) uses your same model, tools, skills, memory and computer, but it starts with only its own messages, not the main chat's. The person finds it as a tab beside the main chat or in the Conversations list next to the tabs, and can read it, write in it, stop it or archive it.";

/**
 * Offered with start_task (main chat and routine conversations): when to open a task, how to
 * brief it and what to do with its reports.
 */
export const AGENT_TASK_GUIDANCE = [
  "Tasks: start_task opens a conversation of your own that works beside this chat while you keep talking with the person.",
  "Start one task for each part when a request has two or more independent parts that each take several steps (research, a review, a build), all in the same turn. Also start a task for long work when the person wants this chat free, or when they switch to a separate topic that will take several steps, such as drafting a forum thread and following its replies.",
  "Do quick parts yourself. Do not start a task for work this turn needs next, for the same files another running task is changing, or for work on the screen or desktop: keep that in this chat.",
  "Write the brief so the task can work alone, since it does not see this chat, and ask it for a compact result. Then tell the person in one sentence what is running and end the turn. Never wait for, poll or read a running task to check on it.",
  "Each finished turn of a task comes back here as a report and starts a turn: give the person the result. While related tasks are still running, add a partial result only when it is useful on its own, and combine everything when the last report arrives. Use message_task to correct or continue a task, read_history with its taskId when a report was cut, and close_task for a task you no longer need. Leave finished tasks open.",
  SIDE_CONVERSATION_SHARING,
].join(" ");

/** Every side conversation: other conversations may work on the same files at the same time. */
export const SHARED_FILES_RULES =
  "Your other conversations may change the same files at the same time, so read a file again right before you change it. Do not run git commands that change the branch, the index or the history (checkout, switch, reset, stash, rebase, commit) unless the person asks for that in this conversation.";

export const TASK_CONVERSATION_INSTRUCTIONS = [
  "This is a side conversation of yours beside your main chat.",
  SIDE_CONVERSATION_SHARING,
  SHARED_FILES_RULES,
].join(" ");

/**
 * The task block of a run: when to open tasks where start_task is offered, and the
 * shared-files rules in every side conversation (a routine conversation gets both).
 */
export function agentTaskInstructions(options: { offersStartTask: boolean; sideConversation: boolean }) {
  if (options.offersStartTask)
    return options.sideConversation ? `${AGENT_TASK_GUIDANCE} ${SHARED_FILES_RULES}` : AGENT_TASK_GUIDANCE;
  return options.sideConversation ? TASK_CONVERSATION_INSTRUCTIONS : undefined;
}

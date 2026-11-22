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

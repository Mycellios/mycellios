import type { DesktopQuestionPrompt, ThreadSnapshot } from "@rakazo/contracts";
import { answerableAskMessageIds, isSecretAskBlock } from "@rakazo/core";

/** Never export credentials or approval cards to the OS question surface. */
export function companionQuestions(botId: string, snapshot: ThreadSnapshot): DesktopQuestionPrompt[] {
  if (snapshot.botId !== botId || snapshot.groupId) return [];
  const pending = answerableAskMessageIds(snapshot);
  return snapshot.messages.flatMap(message => {
    const runId = message.runId;
    if (!pending.has(message.id) || !runId) return [];
    return message.blocks.flatMap((block, index) => {
      if (block.kind !== "ask" || block.status === "answered" || isSecretAskBlock(block) ||
          block.approvalEffectId || block.credential || block.instructionUpdate ||
          (!block.questions?.length && !block.actions?.length)) return [];
      return [{ id: `${runId}:${message.id}:${index}`, botId, runId,
        messageId: message.id, legacy: !block.questions,
        questions: block.questions ?? [{ id: "question-1", question: block.text.slice(0, 240),
          options: block.actions!.map(action => ({ id: action.id, label: action.label })) }],
      }];
    });
  });
}

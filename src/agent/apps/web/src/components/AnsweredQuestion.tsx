import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";

/**
 * A person's answer to an ordinary Mico question. It reads as the person's own
 * reply (their bubble, on their side), with the question kept in a disclosure, so
 * the answer is never mistaken for something the Mico said.
 */
export function AnsweredQuestion({ answer, question }: { answer: string; question: ReactNode }) {
  return (
    <div data-testid="answered-question-card" className="flex w-full min-w-0 flex-col items-end">
      <p
        className="max-w-full whitespace-pre-wrap wrap-anywhere rounded-[20px] bg-chat-user px-3.5 py-2.5 text-body1 text-chat-user-foreground"
        dir="auto"
      >
        {answer}
      </p>
      <details className="mt-1 flex max-w-full flex-col items-end text-xs text-muted-foreground">
        <summary className="ms-auto w-fit cursor-pointer rounded-sm px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          <Trans>View question</Trans>
        </summary>
        <div className="mt-1 break-words rounded-2xl bg-card px-3.5 py-2.5 text-sm text-foreground">{question}</div>
      </details>
    </div>
  );
}

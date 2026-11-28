import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@mycellios/ui-web";
import { AppWindow, BellRing, CalendarClock, Users } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { GUEST_BOT_ID, guestLimits, useGuestRemaining, useGuestTruncatedMessage } from "../../lib/guest-mode";
import { rpc } from "../../lib/rpc";

/** Shown above the guest conversation: what guest mode is and what not to share. */
export function GuestTranscriptNotice() {
  return (
    <p data-guest-notice className="mx-auto mb-4 max-w-2xl rounded-lg border border-border bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
      <Trans>Guest mode. Answers come from a free model served by third-party providers and the Mycellios network. Do not share sensitive information. This chat is kept only in this tab.</Trans>
    </p>
  );
}

/** The sidebar's guest card: free messages left and the way to an account. */
export function GuestSidebarCard() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const remaining = useGuestRemaining() ?? guestLimits()?.messagesPerSession ?? null;
  return (
    <section data-guest-allowed data-guest-card className="mx-3 mb-2 flex shrink-0 flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div>
        <p className="text-sm font-medium">{t`You are trying Mycellios as a guest`}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {remaining === null ? t`Chat with Mico for free, no sign-up needed.`
            : remaining > 0 ? t`${remaining} free messages left. A free account adds your own Micos, files, tools and memory.`
              : t`You have used the free guest messages. Create a free account to keep chatting.`}
        </p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={() => navigate("/sign-up")}><Trans>Create account</Trans></Button>
        <Button size="sm" variant="ghost" onClick={() => navigate("/sign-in")}><Trans>Sign in</Trans></Button>
      </div>
    </section>
  );
}

/**
 * Under the latest guest answer, drawn by the page rather than the model so it is always there:
 * a way to let the visitor's own Mico do the work and, when the model stopped the answer at its
 * length limit, a notice with a button that asks Mico to go on.
 */
export function GuestAnswerFooter({ lastMessageId, idle }: { lastMessageId?: string; idle: boolean }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const truncated = useGuestTruncatedMessage();
  const [continuing, setContinuing] = useState<string | null>(null);
  if (!idle || !lastMessageId) return null;
  const cut = truncated === lastMessageId;
  const goOn = () => {
    if (continuing === lastMessageId) return;
    setContinuing(lastMessageId);
    rpc.threads.send({ botId: GUEST_BOT_ID, text: t`Continue exactly where you stopped.`, clientNonce: crypto.randomUUID() })
      .catch(() => setContinuing(null));
  };
  return (
    <div data-guest-allowed data-guest-answer-footer className="flex flex-col gap-2 px-1 pb-6">
      {cut ? (
        <div data-guest-truncated role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1">{t`This answer reached the length limit and stopped before the end.`}</span>
          <Button size="sm" variant="secondary" disabled={continuing === lastMessageId} onClick={goOn}>{t`Continue`}</Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-3 py-2.5">
        <span className="min-w-[14rem] flex-1 text-[13px] leading-snug text-muted-foreground">
          {t`Want your Mico to do this by itself? With a free account it builds and publishes, works on a schedule and keeps watching.`}
        </span>
        <Button size="sm" onClick={() => navigate("/sign-up")}>{t`Get it running · Create free account`}</Button>
      </div>
    </div>
  );
}

/**
 * Ways to start, under the empty guest conversation. Each one is something an autonomous Mico does
 * on its own (schedules, teams, watching, building), so the visitor sees what sets Micos apart from
 * a chat; sending it asks guest Mico for the concrete plan its own Mico would run.
 */
export function GuestStarters() {
  const { t } = useLingui();
  const [sending, setSending] = useState(false);
  const starters = [
    { icon: CalendarClock, title: t`Works on a schedule`,
      task: t`Every Monday, research my 5 main competitors and send me a summary of what changed` },
    { icon: Users, title: t`A team of Micos`,
      task: t`Put together a team of Micos to launch my product: market research, copy and a launch plan` },
    { icon: BellRing, title: t`Watches and lets you know`,
      task: t`Keep an eye on flight prices to Tokyo in April and tell me when they drop below 600 €` },
    { icon: AppWindow, title: t`Builds things for you`,
      task: t`Build me a simple web app to track my monthly expenses and share it with my partner` },
  ];
  const start = (text: string) => {
    if (sending) return;
    setSending(true);
    rpc.threads.send({ botId: GUEST_BOT_ID, text, clientNonce: crypto.randomUUID() }).catch(() => setSending(false));
  };
  return (
    <div data-guest-allowed data-guest-starters className="mx-auto -mt-4 w-full max-w-2xl px-4 pb-8">
      <p className="mb-3 text-center text-xs font-medium text-muted-foreground">{t`Ask for something a normal chat cannot do`}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {starters.map(({ icon: Icon, title, task }) => (
          <button key={task} type="button" disabled={sending} onClick={() => start(task)}
            className="flex gap-3 rounded-xl border border-border bg-card p-3 text-start transition-colors hover:bg-muted disabled:opacity-60">
            <Icon size={18} strokeWidth={1.7} aria-hidden className="mt-0.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{title}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{task}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

import { botColors } from "@rakazo/ui-tokens";
import { useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import { BotAvatar } from "@rakazo/ui-web";
import { CircleCheck, CircleDashed, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

export function TaskEmptyPitch() {
  const { t } = useLingui();
  return (
    <div className="rk-task-pitch">
      <h1>
        <span>{t`Delegate the work.`}</span>
        <span>
          {t`Come back and find an`} <em>{t`answer`}</em>.
        </span>
      </h1>
      <p>
        {t`Your agents work on tasks in parallel.`}
        <br />
        {t`Every answer is waiting here.`}
      </p>
    </div>
  );
}
export function TaskEmptyBoard({ bots }: { bots: Bot[] }) {
  const { t } = useLingui();
  const [step, setStep] = useState(2);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setStep((value) => value + 1), 2400);
    return () => clearInterval(timer);
  }, []);
  const samples = [
    {
      title: t`Summarize the open hiring processes for the support position`,
      progress: t`Reviewing applications`,
    },
    { title: t`Find recent papers about document retrieval`, progress: t`Searching arxiv.org` },
    { title: t`Prepare the call notes with Northwind Traders`, progress: t`Preparing notes` },
    { title: t`Plan the next team offsite`, progress: t`Comparing options` },
    { title: t`Review this paper and summarize its findings`, progress: t`Reading the paper` },
    { title: t`Organize the contacts from the last meeting`, progress: t`Organizing contacts` },
  ];
  return (
    <><p className="mt-6 text-center text-xs text-muted-foreground">{t`Example tasks — these are not running.`}</p><div className="rk-task-examples" aria-hidden="true" inert>
      {[t`Needs you`, t`Working`, t`Waiting`].map((label) => (
        <div className="rk-task-example-section" key={label}>
          <span>
            {label} <span className="ms-1">1</span>
          </span>
        </div>
      ))}
      {[step - 2, step - 1, step].map((index, slot) => {
        const sample = samples[index % samples.length]!,
          bot = bots[index % Math.max(1, bots.length)],
          Icon = slot === 0 ? CircleCheck : slot === 1 ? LoaderCircle : CircleDashed;
        return (
          <div
            key={index}
            className="rk-task-example-row rk-task-row"
            style={{ top: 28 + slot * 80 }}
          >
            <Icon size={14} className={slot === 1 ? "rk-task-spinner" : ""} />
            <span className="rk-task-row-title">{sample.title}</span>
            <span className={slot === 0 ? "rk-task-answered" : ""}>
              {slot === 0
                ? t({ context: "task status", message: "Answered" })
                : slot === 1
                  ? sample.progress
                  : t`Waiting`}
            </span>
            <BotAvatar identity={bot?.id ?? "sample"} color={bot?.color ?? botColors[3]} size={18} />
          </div>
        );
      })}
    </div></>
  );
}

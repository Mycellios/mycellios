import { useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import { BotAvatar, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@rakazo/ui-web";
import { Check, Pause, Play, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { calendarDays, civilDate } from "./calendar-dates";
import "./schedule-empty-state.css";

export function ScheduleEmptyState({ bots, anchor, today, onCreateRoutine, onCreateMico }: {
  bots: Bot[]; anchor: string; today: string; onCreateRoutine: (botId: string) => void; onCreateMico: () => void;
}) {
  const { t, i18n } = useLingui();
  const root = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(true);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReduced(media.matches);
    const syncPage = () => setPageVisible(!document.hidden);
    syncMotion(); syncPage(); media.addEventListener("change", syncMotion); document.addEventListener("visibilitychange", syncPage);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)));
    if (root.current) observer?.observe(root.current);
    return () => { observer?.disconnect(); media.removeEventListener("change", syncMotion); document.removeEventListener("visibilitychange", syncPage); };
  }, []);
  const days = calendarDays(anchor, "month");
  const first = civilDate(days[0]!);
  const weekday = new Intl.DateTimeFormat(i18n.locale || "en", { weekday: "short", timeZone: "UTC" });
  const examples = [
    { name: t`Morning briefing`, time: "07:00", note: t`Your priorities, ready before the day begins.`, className: "briefing", bot: bots[0] },
    { name: t`Inbox, in order`, time: "09:00", note: t`The important messages. None of the noise.`, className: "inbox", bot: bots[1] ?? bots[0] },
    { name: t`Weekly overview`, time: "17:30", note: t`A clear picture of what moved forward.`, className: "overview", bot: bots[2] ?? bots[0] },
  ];
  const createLabel = <><Plus size={16} aria-hidden />{t`Create Routine`}</>;
  return <div className="rk-schedule-welcome" ref={root} data-testid="schedule-empty-state" data-animate={playing && visible && pageVisible && !reduced}>
    <div className="rk-schedule-welcome-stage">
      <div className="rk-schedule-demo" aria-hidden="true">
        <div className="rk-schedule-demo-weekdays">{Array.from({ length: 7 }, (_, i) => <span key={i}>{weekday.format(new Date(first.getTime() + i * 86400000))}</span>)}</div>
        <div className="rk-schedule-demo-grid">{days.map(day => <div key={day} data-outside={day.slice(0, 7) !== anchor.slice(0, 7)}><span data-today={day === today}>{civilDate(day).getUTCDate()}</span></div>)}</div>
        <div className="rk-schedule-demo-clock" />
        {examples.map(example => <div key={example.className} className={`rk-schedule-demo-run rk-schedule-demo-${example.className}`}>
          <div className="rk-schedule-demo-receipt">
            <div><Check size={13}/><time>{example.time}</time><BotAvatar identity={example.bot?.id ?? "schedule-example"} color={example.bot?.color ?? "#3BA582::shape_2000"} size={20}/></div>
            <strong>{example.name}</strong>
          </div>
          <p className="rk-schedule-demo-note">{example.note}</p>
          <svg className="rk-schedule-demo-underline" viewBox="0 0 200 12" preserveAspectRatio="none"><path d="M3 8 Q60 2 105 6 T197 3" pathLength="1" /></svg>
        </div>)}
      </div>
      <div className="rk-schedule-welcome-copy">
        <h2>{t`A little planning.`}<br/><span>{t`A lot already done.`}</span></h2>
        <p>{t`Give your Micos a time and a task.`}<br/>{t`Come back to useful results, right in your chat.`}</p>
        {bots.length === 1 ? <Button size="lg" onClick={() => onCreateRoutine(bots[0]!.id)}>{createLabel}</Button> : bots.length > 1 ? <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="lg" />}>{createLabel}</DropdownMenuTrigger>
          <DropdownMenuContent>{bots.map(bot => <DropdownMenuItem key={bot.id} onClick={() => onCreateRoutine(bot.id)}><BotAvatar identity={bot.id} color={bot.color} size={20}/>{bot.name}</DropdownMenuItem>)}</DropdownMenuContent>
        </DropdownMenu> : <Button size="lg" onClick={() => onCreateMico()}><Plus size={16} aria-hidden />{t`Create a Mico`}</Button>}
        <span>{t`You choose the schedule. Your Mico takes care of the rest.`}</span>
      </div>
    </div>
    <footer className="rk-schedule-welcome-footer">
      <span>{t`Illustrative schedule · no tasks are running`}</span>
      {!reduced ? <Button variant="ghost" size="sm" aria-label={playing ? t`Pause preview` : t`Play preview`} aria-pressed={!playing} onClick={() => setPlaying(value => !value)}>
        {playing ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}{playing ? t`Pause preview` : t`Play preview`}
      </Button> : null}
    </footer>
  </div>;
}

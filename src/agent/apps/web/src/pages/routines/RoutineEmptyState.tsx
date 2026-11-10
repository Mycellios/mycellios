import { useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import { BotAvatar, Button } from "@rakazo/ui-web";
import { CalendarClock, Check, FileText, Pause, Play, Plus, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "./routine-empty-state.css";

/** A labelled, inert example. Only Create can open a real, unsaved routine. */
export function RoutineEmptyState({ bot, onCreate }: { bot: Bot; onCreate: () => void }) {
  const { t } = useLingui();
  const root = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(true);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReduced(motion.matches);
    const syncPage = () => setPageVisible(!document.hidden);
    syncMotion(); syncPage();
    motion.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncPage);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)));
    if (root.current) observer?.observe(root.current);
    return () => { observer?.disconnect(); motion.removeEventListener("change", syncMotion); document.removeEventListener("visibilitychange", syncPage); };
  }, []);
  return <div ref={root} className="rk-routine-empty" data-testid="routine-empty-state" data-animate={playing && visible && pageVisible && !reduced}>
    <div className="rk-routine-empty-stage">
      <div className="rk-routine-example" aria-hidden="true">
        <svg className="rk-routine-example-links" viewBox="0 0 1000 680" preserveAspectRatio="none" fill="none">
          <path d="M225 335 C310 335 270 150 365 150 M225 335 C305 335 300 535 390 535 M550 150 C680 150 650 330 790 330 M575 535 C700 535 720 415 790 415" className="rk-routine-example-track" />
          <path d="M225 335 C310 335 270 150 365 150 M225 335 C305 335 300 535 390 535 M550 150 C680 150 650 330 790 330 M575 535 C700 535 720 415 790 415" className="rk-routine-example-signal" />
        </svg>
        <div className="rk-routine-sample rk-routine-sample-trigger">
          <div className="rk-routine-sample-heading"><CalendarClock /><span>{t`Every morning`}<strong>{t`Morning briefing`}</strong></span></div>
          <p>{t`Review the day's priorities and prepare a short summary.`}</p>
          <div className="rk-routine-sample-foot">{t`Weekdays · 09:00`}<span className="rk-routine-sample-days"><i/><i/><i/><i/><i/><i/><i/></span></div>
        </div>
        <div className="rk-routine-sample rk-routine-sample-agent">
          <div className="rk-routine-sample-heading"><BotAvatar identity={bot.id} color={bot.color} size={25} /><span>{t`Your Mico`}<strong>{bot.name}</strong></span></div>
          <p>{t`Gather what matters. Turn it into a clear plan.`}</p>
          <div className="rk-routine-sample-progress"><span /></div>
          <div className="rk-routine-sample-foot">{t`Preparing the summary`}</div>
        </div>
        <div className="rk-routine-sample rk-routine-sample-notes">
          <div className="rk-routine-sample-heading"><FileText /><span>{t`A clear next step`}<strong>{t`Priorities for today`}</strong></span></div>
          <div className="rk-routine-sample-lines"><i/><i/><i/></div>
          <div className="rk-routine-sample-foot">{t`Everything in one place`}</div>
        </div>
        <div className="rk-routine-sample rk-routine-sample-result">
          <div className="rk-routine-sample-heading"><Check /><span>{t`The result`}<strong>{t`Your briefing is ready`}</strong></span></div>
          <p>{t`A useful update in your chat. No extra steps.`}</p>
          <div className="rk-routine-sample-foot"><Sparkles />{t`Ready when you are`}</div>
        </div>
      </div>
      <div className="rk-routine-empty-copy">
        <h1>{t`Set it up once.`}<br/><span>{t`Let your Mico take it from here.`}</span></h1>
        <p>{t`Choose when. Tell your Mico what to do.`}<br/>{t`Find the result right in your chat.`}</p>
        <Button size="lg" onClick={() => onCreate()}><Plus size={17} aria-hidden />{t`Create Routine`}</Button>
        <span className="rk-routine-empty-reassurance">{t`Review everything before activating it.`}</span>
      </div>
    </div>
    <footer className="rk-routine-empty-footer">
      <span>{t`Illustrative example · no tasks are running`}</span>
      {!reduced ? <Button variant="ghost" size="sm" aria-label={playing ? t`Pause preview` : t`Play preview`} aria-pressed={!playing} onClick={() => setPlaying(value => !value)}>
        {playing ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}{playing ? t`Pause preview` : t`Play preview`}
      </Button> : null}
    </footer>
  </div>;
}

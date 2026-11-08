import { useLingui } from "@lingui/react/macro";
import type { Bot, Routine, RoutineCalendar, RoutineCalendarEntry, Space } from "@rakazo/contracts";
import {
  BotAvatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rakazo/ui-web";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  CirclePause,
  Clock3,
  LoaderCircle,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { desktopDragClass, desktopHidesTitleBar } from "../../lib/desktop";
import { localTimezone } from "../../lib/local-timezone";
import type { RpcClient } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { routineDiagramSummary } from "../routines/routine-summary";
import {
  type CalendarView,
  calendarDays,
  calendarRange,
  civilDate,
  clockChange,
  dateInZone,
  shiftDay,
  shiftMonth,
} from "./calendar-dates";
import "../tasks/tasks.css";
import "./schedule.css";

export function ScheduleWorkspace({
  client,
  scope,
  bots,
  spaces,
  spaceId,
  onSpace,
  onExit,
  onOpenRoutine,
  onOpenBot,
  onCreateRoutine,
}: {
  client: RpcClient;
  scope: string;
  bots: Bot[];
  spaces: Space[];
  spaceId: string | null;
  onSpace: (id: string, path: string) => void;
  onExit: () => void;
  onOpenRoutine: (routine: Routine) => void;
  onOpenBot: (id: string) => void;
  onCreateRoutine: (id: string) => void;
}) {
  const { t, i18n } = useLingui();
  const zone = localTimezone(),
    locale = i18n.locale || "en";
  const key = `mycellios:schedule:${scope}`;
  const [now, setNow] = useState(() => new Date());
  const today = dateInZone(now, zone);
  const [position, setPosition] = useState<{ anchor: string; view: CalendarView }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      if (
        /^\d{4}-\d{2}-\d{2}$/.test(saved?.anchor) &&
        ["day", "week", "month"].includes(saved?.view) &&
        Number.isFinite(civilDate(saved.anchor).getTime())
      )
        return saved;
    } catch {
      /* Start at the current week if preferences are unavailable. */
    }
    return { anchor: today, view: "week" };
  });
  const { anchor, view } = position,
    days = calendarDays(anchor, view);
  const { from, to } = calendarRange(days);
  const [data, setData] = useState<RoutineCalendar | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, retry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(position));
    } catch {
      /* Navigation remains available. */
    }
  }, [key, position]);
  useEffect(() => {
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    setLoading(true);
    setData(null);
    setError("");
    async function load() {
      try {
        const result = await client.routines.calendar({ from, to });
        if (!live) return;
        setData(result);
        setNow(new Date(result.now));
        setLoading(false);
        setError("");
        timer = setTimeout(load, 15_000);
      } catch (cause) {
        if (live) {
          setError(errorText(cause));
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, from, to, revision]);
  function move(next: string, nextView = view, focus = false) {
    setPosition({ anchor: next, view: nextView });
    if (focus) heading.current?.focus();
  }
  const formatDay = (day: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" })
      .format(civilDate(day))
      .replaceAll(".", "");
  const time = (at: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(
      new Date(at),
    );
  const longDay = (day: string) =>
    formatDay(day, { weekday: "long", month: "long", day: "numeric" });
  const rangeText =
    view === "day"
      ? longDay(anchor)
      : view === "month"
        ? formatDay(anchor, { month: "long", year: "numeric" })
        : `${formatDay(days[0]!, { day: "numeric", month: "short" })} – ${formatDay(days.at(-1)!, { day: "numeric", month: "short", year: "numeric" })}`;
  const visibleToday =
    view === "month" ? today.slice(0, 7) === anchor.slice(0, 7) : days.includes(today);
  const byRoutine = new Map(data?.routines.map((routine) => [routine.id, routine]));
  const entries = (data?.entries ?? []).filter((entry) => byRoutine.has(entry.routineId));
  const grouped = new Map<string, RoutineCalendarEntry[]>();
  for (const entry of entries) {
    const day = dateInZone(new Date(entry.at), zone);
    const list = grouped.get(day) ?? [];
    list.push(entry);
    grouped.set(day, list);
  }
  const forDay = (day: string) => grouped.get(day) ?? [];
  const upcoming = entries
    .filter(
      (entry) =>
        entry.status === "scheduled" &&
        Date.parse(entry.at) >= now.getTime() &&
        days.includes(dateInZone(new Date(entry.at), zone)),
    )
    .slice(0, 6);
  const changed = clockChange(
    days.filter((day) => view !== "month" || day.slice(0, 7) === anchor.slice(0, 7)),
    zone,
  );
  function status(entry: RoutineCalendarEntry) {
    switch (entry.status) {
      case "scheduled":
        return t`Scheduled`;
      case "paused":
        return t`Paused`;
      case "completed":
        return t`Completed`;
      case "failed":
        return t`Failed`;
      case "cancelled":
        return t`Stopped`;
      case "queued":
        return t`Queued`;
      case "waiting_input":
      case "waiting_takeover":
        return t`Needs you`;
      default:
        return t`Working`;
    }
  }
  function mark(entry: RoutineCalendarEntry) {
    if (entry.status === "scheduled")
      return <span className="rk-schedule-dot" aria-hidden="true" />;
    const Icon =
      entry.status === "completed"
        ? Check
        : entry.status === "paused"
          ? CirclePause
          : ["failed", "cancelled"].includes(entry.status)
            ? X
            : entry.projected
              ? Clock3
              : LoaderCircle;
    return (
      <Icon
        aria-hidden="true"
        size={12}
        className={`rk-schedule-mark ${entry.status === "completed" ? "rk-schedule-success" : entry.status === "failed" ? "text-destructive" : ""}`}
      />
    );
  }
  function card(entry: RoutineCalendarEntry) {
    const routine = byRoutine.get(entry.routineId)!,
      bot = bots.find((bot) => bot.id === routine.botId);
    return (
      <li key={entry.id}>
        <button
          type="button"
          className="rk-schedule-event"
          data-status={entry.status}
          aria-label={`${routine.name}, ${time(entry.at)}, ${status(entry)}`}
          title={entry.error || `${routine.name} · ${status(entry)}`}
          onClick={() => onOpenRoutine(routine)}
        >
          {mark(entry)}
          <time dateTime={entry.at}>{time(entry.at)}</time>
          <span className="rk-schedule-event-name">{routine.name}</span>
          <span className="rk-schedule-avatar" aria-hidden="true">
            <BotAvatar identity={routine.botId} color={bot?.color ?? "#9B5CF6"} size={16} />
          </span>
        </button>
      </li>
    );
  }
  function row(entry: RoutineCalendarEntry, when: string) {
    const routine = byRoutine.get(entry.routineId)!,
      bot = bots.find((bot) => bot.id === routine.botId);
    return (
      <li className="rk-schedule-entry" data-status={entry.status} key={entry.id}>
        <button
          type="button"
          className="rk-schedule-entry-main"
          onClick={() => onOpenRoutine(routine)}
        >
          {mark(entry)}
          <span>
            <strong>{routine.name}</strong>
            <small title={entry.error ?? undefined}>
              {when} · {routineDiagramSummary(routine, locale)} · {status(entry)}
            </small>
          </span>
        </button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t`Open Mico ${bot?.name ?? ""}`}
          onClick={() => onOpenBot(routine.botId)}
        >
          <BotAvatar identity={routine.botId} color={bot?.color ?? "#9B5CF6"} size={21} />
        </Button>
      </li>
    );
  }
  const hours = new Map<string, RoutineCalendarEntry[]>();
  if (view === "day")
    for (const entry of forDay(anchor)) {
      const hour = new Intl.DateTimeFormat(locale, {
        timeZone: zone,
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date(entry.at));
      hours.set(hour, [...(hours.get(hour) ?? []), entry]);
    }
  return (
    <section
      className="rk-schedule-workspace"
      data-testid="schedule-workspace"
      aria-label={t`Schedule`}
      data-view={view}
    >
      <header
        className={`rk-schedule-header ${desktopDragClass()}`}
        data-testid="conversation-header"
        style={desktopHidesTitleBar() ? { paddingInlineStart: 48 } : undefined}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            className="app-no-drag rk-schedule-space"
            aria-label={t`Switch workspace`}
          >
            <span>{spaces.find((space) => space.id === spaceId)?.name ?? "Mycellios"}</span>
            <ChevronsUpDown size={11} />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {spaces.map((space) => (
              <DropdownMenuItem
                key={space.id}
                onClick={() =>
                  onSpace(
                    space.id,
                    space.bots[0] ? `/app/${space.bots[0].id}?view=schedule` : "/onboarding",
                  )
                }
              >
                {space.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          className="app-no-drag"
          variant="ghost"
          size="icon-sm"
          aria-label={t`Back to chat`}
          onClick={onExit}
        >
          <ArrowLeft size={15} />
        </Button>
        <Button
          data-schedule-forward
          className="app-no-drag"
          variant="ghost"
          size="icon-sm"
          aria-label={t`Forward`}
          disabled
        >
          <ArrowRight size={15} />
        </Button>
        <span className="rk-schedule-divider" />
        <h1 ref={heading} tabIndex={-1}>{t`Schedule`}</h1>
        <p>{t`Times in ${zone}`}</p>
      </header>
      <div className="rk-schedule-content rk-scroll">
        <p className="rk-schedule-mobile-zone">{t`Times in ${zone}`}</p>
        <div className="rk-schedule-toolbar">
          <div className="rk-schedule-navigation">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={
                view === "day"
                  ? t`Previous day`
                  : view === "week"
                    ? t`Previous week`
                    : t`Previous month`
              }
              onClick={() =>
                move(
                  view === "month"
                    ? shiftMonth(anchor, -1)
                    : shiftDay(anchor, view === "week" ? -7 : -1),
                )
              }
            >
              <ChevronLeft size={14} />
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={visibleToday}
              onClick={() => move(today, view, true)}
            >{t`Today`}</Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={
                view === "day" ? t`Next day` : view === "week" ? t`Next week` : t`Next month`
              }
              onClick={() =>
                move(
                  view === "month"
                    ? shiftMonth(anchor, 1)
                    : shiftDay(anchor, view === "week" ? 7 : 1),
                )
              }
            >
              <ChevronRight size={14} />
            </Button>
            <p aria-live="polite" data-testid="schedule-range">
              {rangeText}
            </p>
          </div>
          <fieldset className="rk-schedule-tabs" aria-label={t`Calendar view`}>
            {(["day", "week", "month"] as const).map((mode) => (
              <button
                type="button"
                key={mode}
                aria-pressed={view === mode}
                onClick={() => move(anchor, mode)}
              >
                {mode === "day" ? t`Day` : mode === "week" ? t`Week` : t`Month`}
              </button>
            ))}
          </fieldset>
        </div>
        {changed ? (
          <p className="rk-schedule-note">{t`Clocks change on ${longDay(changed)}. Times follow ${zone}.`}</p>
        ) : null}
        {error ? (
          <p className="rk-schedule-error" role="alert">
            {t`Could not load the schedule.`} {error}
            <Button
              size="xs"
              variant="ghost"
              onClick={() => retry((value) => value + 1)}
            >{t`Retry`}</Button>
          </p>
        ) : null}
        {data?.truncated || data?.invalidRoutineIds.length ? (
          <p
            className="rk-schedule-note"
            role="status"
          >{t`Some occurrences could not be displayed. Choose a smaller range or review the routines.`}</p>
        ) : null}
        {loading ? <p className="sr-only" role="status">{t`Loading schedule…`}</p> : null}
        {!loading && data?.routines.length === 0 ? (
          <div className="rk-schedule-empty">
            <Clock3 size={30} />
            <h2>{t`Give your Micos a schedule.`}</h2>
            <p>{t`Create a routine to see its upcoming runs here.`}</p>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="rk-schedule-create"
                disabled={!bots.length}
              >{t`Create Routine`}</DropdownMenuTrigger>
              <DropdownMenuContent>
                {bots.map((bot) => (
                  <DropdownMenuItem key={bot.id} onClick={() => onCreateRoutine(bot.id)}>
                    <BotAvatar identity={bot.id} color={bot.color} size={18} />
                    {bot.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
        {loading || (data && data.routines.length > 0) ? (
          <div className="rk-schedule-body" aria-busy={loading}>
            {view === "day" ? (
              <div className="rk-schedule-day-view">
                {hours.size ? (
                  [...hours].map(([hour, group]) => (
                    <section key={hour} className="rk-schedule-hour">
                      <h2>{hour}:00</h2>
                      <ul>{group.map((entry) => row(entry, time(entry.at)))}</ul>
                    </section>
                  ))
                ) : !loading ? (
                  <p className="rk-schedule-muted">{t`No runs on this day.`}</p>
                ) : null}
              </div>
            ) : (
              <div className="rk-schedule-grid-wrap">
                {view === "month" ? (
                  <div className="rk-schedule-weekdays" aria-hidden="true">
                    {days.slice(0, 7).map((day) => (
                      <span key={day}>{formatDay(day, { weekday: "short" })}</span>
                    ))}
                  </div>
                ) : null}
                <ol className={`rk-schedule-grid ${loading ? "rk-schedule-loading" : ""}`}>
                  {days.map((day) => {
                    const all = forDay(day),
                      limit = view === "month" ? 3 : 4;
                    return (
                      <li
                        className="rk-schedule-day"
                        key={day}
                        aria-current={day === today ? "date" : undefined}
                        data-past={day < today || undefined}
                        data-outside={
                          (view === "month" && day.slice(0, 7) !== anchor.slice(0, 7)) || undefined
                        }
                        data-testid={`schedule-day-${day}`}
                      >
                        <h2>
                          <button
                            type="button"
                            onClick={() => move(day, "day", true)}
                            aria-label={t`Open ${longDay(day)}`}
                          >
                            <span>{formatDay(day, { weekday: "short" })}</span>
                            <strong className="rk-schedule-day-number">
                              {Number(day.slice(-2))}
                            </strong>
                          </button>
                        </h2>
                        {loading ? (
                          <div className="rk-schedule-skeleton" />
                        ) : (
                          <ul>{all.slice(0, limit).map(card)}</ul>
                        )}
                        {all.length > limit ? (
                          <button
                            type="button"
                            className="rk-schedule-more"
                            onClick={() => move(day, "day", true)}
                          >{t`+${all.length - limit} more`}</button>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
            <aside className="rk-schedule-upcoming" aria-label={t`Upcoming runs`}>
              <h2>{t`Upcoming runs`}</h2>
              {upcoming.length ? (
                <ul>
                  {upcoming.map((entry) =>
                    row(
                      entry,
                      `${formatDay(dateInZone(new Date(entry.at), zone), { weekday: "short", day: "numeric", month: "short" })} ${time(entry.at)}`,
                    ),
                  )}
                </ul>
              ) : (
                <p>{loading ? t`Loading schedule…` : t`No upcoming runs.`}</p>
              )}
            </aside>
          </div>
        ) : null}
      </div>
    </section>
  );
}

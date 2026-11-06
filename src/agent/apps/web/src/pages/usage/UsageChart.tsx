import { Input } from "@rakazo/ui-web";
import { useLingui } from "@lingui/react/macro";
import type { UsageDashboard } from "@rakazo/contracts";
import { useEffect, useId, useRef, useState } from "react";
import {
  chartSeries,
  knownSegments,
  monotoneLine,
  providerColor,
  providerName,
  type UsageMetric,
} from "./usage-chart";

export function UsageChart({
  report,
  metric,
  money,
  compact,
  preciseMoney,
}: {
  report: UsageDashboard;
  metric: UsageMetric;
  money: (amount: number | null) => string;
  compact: (amount: number | null) => string;
  preciseMoney: (amount: number | null) => string;
}) {
  const { t, i18n } = useLingui();
  const wrap = useRef<HTMLDivElement>(null),
    id = useId();
  const [width, setWidth] = useState(680),
    [hover, select] = useState<number | null>(null);
  useEffect(() => {
    const node = wrap.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(250, node.clientWidth)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const chart = chartSeries(report, metric),
    rows = chart.rows;
  const maximum = rows.reduce(
    (max, row) => row.values.reduce<number>((value, next) => Math.max(value, next ?? 0), max),
    0,
  );
  const top = maximum > 0 ? maximum * 1.08 : 1;
  const format = metric === "cost" ? money : compact;
  const precise = (value: number | null) =>
    metric === "cost"
      ? preciseMoney(value)
      : value === null
        ? t`Unavailable`
        : new Intl.NumberFormat(i18n.locale || "en").format(value);
  const left = Math.max(78, format(top).length * 6 + 8),
    right = width - 12,
    bottom = 270;
  const x = (index: number) => left + ((right - left) * index) / Math.max(1, rows.length - 1),
    y = (amount: number) => bottom - ((bottom - 12) * amount) / top;
  const date = (day: string, full = false) =>
    new Intl.DateTimeFormat(i18n.locale || "en", {
      timeZone: "UTC",
      day: "numeric",
      month: full ? "long" : "short",
      ...(full ? { year: "numeric" } : {}),
    })
      .format(new Date(`${day}T12:00:00Z`))
      .replaceAll(".", "");
  const tickCount = Math.max(2, Math.min(5, Math.floor((right - left) / 100)));
  const selected = hover === null ? null : rows[Math.min(hover, rows.length - 1)];
  return (
    <div className="rk-usage-chart" ref={wrap}>
      <Input
        type="range"
        className="sr-only"
        aria-label={t`Inspect chart day`}
        aria-describedby={`${id}-help`}
        min={0}
        max={Math.max(0, rows.length - 1)}
        value={hover ?? 0}
        aria-valuetext={
          rows[hover ?? 0]
            ? `${date(rows[hover ?? 0]!.day, true)} · ${chart.providers.map((provider, index) => `${providerName(provider)}: ${precise(rows[hover ?? 0]!.values[index] ?? null)}`).join(" · ")}`
            : ""
        }
        onFocus={() => select(hover ?? 0)}
        onChange={(event) => select(Number(event.target.value))}
        onBlur={() => select(null)}
        onKeyDown={(event) => {
          if (event.key === "Escape") select(null);
        }}
      />
      <svg
        width="100%"
        height="306"
        viewBox={`0 0 ${width} 306`}
        role="img"
        aria-label={
          metric === "cost"
            ? t`Daily cost in USD by provider`
            : t`Daily tokens excluding cache reads by provider`
        }
        aria-describedby={`${id}-help`}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          select(
            Math.max(
              0,
              Math.min(
                rows.length - 1,
                Math.round(
                  ((((event.clientX - rect.left) * width) / rect.width - left) / (right - left)) *
                    (rows.length - 1),
                ),
              ),
            ),
          );
        }}
        onPointerLeave={() => select(null)}
      >
        <title>{metric === "cost" ? t`Daily cost` : t`Daily tokens`}</title>
        {[0, 1, 2, 3].map((index) => {
          const value = (top * (3 - index)) / 3,
            position = y(value);
          return (
            <g key={index}>
              <line x1={left} x2={right} y1={position} y2={position} stroke="var(--border)" />
              <text x={left - 8} y={position + 4} textAnchor="end">
                {format(value)}
              </text>
            </g>
          );
        })}
        {chart.providers.map((provider, series) =>
          knownSegments(rows.map((row) => row.values[series] ?? null)).map((segment, index) => {
            const points = segment.map((point) => ({ x: x(point.index), y: y(point.value) })),
              line = monotoneLine(points),
              first = points[0]!,
              last = points.at(-1)!;
            return (
              <g key={`${provider}:${index}`}>
                <path
                  d={`${line}L${last.x},${bottom}L${first.x},${bottom}Z`}
                  fill={providerColor(provider)}
                  fillOpacity="0.12"
                />
                <path d={line} fill="none" stroke={providerColor(provider)} strokeWidth="1.2" />
                {points.length === 1 ? (
                  <circle cx={first.x} cy={first.y} r={2} fill={providerColor(provider)} />
                ) : null}
              </g>
            );
          }),
        )}
        {Array.from({ length: tickCount }, (_, index) =>
          Math.round(((index + 1) * (rows.length - 1)) / tickCount),
        ).map((index) =>
          rows[index] ? (
            <text key={index} x={x(index)} y={298} textAnchor="middle">
              {date(rows[index]!.day).toUpperCase()}
            </text>
          ) : null,
        )}
        {selected ? (
          <line
            x1={x(hover!)}
            x2={x(hover!)}
            y1={12}
            y2={bottom}
            stroke="var(--muted-foreground)"
            strokeDasharray="3 3"
          />
        ) : null}
      </svg>
      <p
        className="sr-only"
        id={`${id}-help`}
      >{t`Use the arrow keys to inspect days, or open the daily data table.`}</p>
      {selected ? (
        <div className="rk-usage-tooltip" role="status">
          <strong>{date(selected.day, true)}</strong>
          {chart.providers.map((provider, index) => (
            <div key={provider}>
              <span>
                <i style={{ background: providerColor(provider) }} />
                {providerName(provider)}
              </span>
              <span>{precise(selected.values[index] ?? null)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

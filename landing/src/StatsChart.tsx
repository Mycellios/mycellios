import { Card, Heading, Text } from "./ui/primitives";
import type { NetworkTelemetrySample } from "./NetworkPage";

type Metric = "connectedNodes" | "offeredVramMb" | "freeVramMb" | "runningJobs" | "activeModels" | "completedJobs";
export function StatsChart({ title, samples, metric, unit, divisor = 1, loading }: { title: string; samples: NetworkTelemetrySample[]; metric: Metric; unit: string; divisor?: number; loading: boolean }) {
  const ordered = samples.slice().sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const points = ordered.length <= 160 ? ordered : Array.from({ length: 160 }, (_, index) => ordered[Math.round(index * (ordered.length - 1) / 159)]!);
  const values = points.map(point => point[metric] / divisor), maximum = Math.max(1, ...values), width = 520, height = 155;
  const x = (i: number) => points.length === 1 ? width / 2 : 8 + i / (points.length - 1) * (width - 16), y = (value: number) => height - 12 - value / maximum * (height - 28);
  const path = values.map((value, index) => index === 0 ? `M${x(index)} ${y(value)}` : `L${x(index)} ${y(values[index - 1]!)}L${x(index)} ${y(value)}`).join(" ");
  const date = (value: string) => new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value));
  return <Card className="stats-chart"><header><Heading as="h3">{title}</Heading><Text as="span">{values.length ? `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(values.at(-1)!)} ${unit}` : "—"}</Text></header>{values.length ? <><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}: ${samples.length} persisted observations`}><title>{title}. {samples.length} persisted observations. Latest value {values.at(-1)} {unit}.</title>{values.length === 1 ? <circle cx={x(0)} cy={y(values[0]!)} r="3" /> : <path d={path} vectorEffect="non-scaling-stroke" />}</svg><div className="stats-chart-dates"><span>{date(points[0]!.capturedAt)}</span><span>{date(points.at(-1)!.capturedAt)}</span></div></> : <Text className="stats-chart-empty">{loading ? "Loading observations…" : "No persisted observations in this range."}</Text>}</Card>;
}

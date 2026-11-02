export type ProbeOptions = { routeProbeIntervalSeconds?: number; routeProbeTimeoutSeconds?: number };

export function normalizeRouteProbes(value: {
  routeProbeIntervalSeconds?: unknown; routeProbeTimeoutSeconds?: unknown;
}): ProbeOptions {
  const result: ProbeOptions = {};
  for (const [key, positive] of [["routeProbeIntervalSeconds", false], ["routeProbeTimeoutSeconds", true]] as const) {
    const number = value[key];
    if (number === undefined) continue;
    if (typeof number !== "number" || !Number.isFinite(number) || (positive ? number <= 0 : number < 0)) {
      throw new Error(positive ? "python_route_probe_timeout_is_invalid" : "python_route_probe_interval_is_invalid");
    }
    result[key] = number;
  }
  return result;
}

export function routeProbeArguments(value: ProbeOptions): string[] {
  const args: string[] = [];
  if (value.routeProbeIntervalSeconds !== undefined) args.push("--route-probe-interval-seconds", String(value.routeProbeIntervalSeconds));
  if (value.routeProbeTimeoutSeconds !== undefined) args.push("--route-probe-timeout-seconds", String(value.routeProbeTimeoutSeconds));
  return args;
}

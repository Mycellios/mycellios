import { appPath } from "./app-path";
import { CLIENT_BUILD } from "./client-build";
import { desktopBridge } from "./desktop";

/**
 * A support report a person can paste into a message. It holds versions, the platform and
 * how the server answers right now. Never account, Space, Mico or conversation data, and
 * nothing is sent anywhere: the person copies it and decides where it goes.
 */
export type DiagnosticFacts = {
  generatedAt: string;
  webBuild: string;
  desktopVersion: string | null;
  serverRevision: string | null;
  latenciesMs: number[];
  failedProbes: number;
  userAgent: string;
  language: string;
  timeZone: string;
  online: boolean;
  viewport: string;
};

export function formatDiagnosticReport(facts: DiagnosticFacts): string {
  const sorted = [...facts.latenciesMs].sort((a, b) => a - b);
  const latency = sorted.length
    ? `${sorted.map((ms) => `${Math.round(ms)} ms`).join(" / ")} (median ${Math.round(sorted[Math.floor(sorted.length / 2)]!)} ms)`
    : "no answer";
  return [
    "Mycellios diagnostic report",
    `Generated: ${facts.generatedAt}`,
    `Web build: ${facts.webBuild || "development"}`,
    `App: ${facts.desktopVersion ? `Desktop ${facts.desktopVersion}` : "browser"}`,
    `Server revision: ${facts.serverRevision ?? "unknown"}`,
    `Server latency: ${latency}${facts.failedProbes ? `, ${facts.failedProbes} failed` : ""}`,
    `Online: ${facts.online ? "yes" : "no"}`,
    `Platform: ${facts.userAgent}`,
    `Language: ${facts.language} · Time zone: ${facts.timeZone} · Window: ${facts.viewport}`,
  ].join("\n");
}

const PROBES = 3;
const PROBE_TIMEOUT_MS = 8_000;
const REVISION = /^[0-9a-f]{7,40}$/i;

async function probeServer(fetcher: typeof fetch, now: () => number) {
  const latenciesMs: number[] = [];
  let revision: string | null = null;
  let failed = 0;
  for (let attempt = 0; attempt < PROBES; attempt++) {
    const start = now();
    try {
      const response = await fetcher(appPath("/ready"), {
        cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(response.status));
      latenciesMs.push(now() - start);
      const value = body && typeof body === "object" ? (body as { revision?: unknown }).revision : null;
      if (typeof value === "string" && REVISION.test(value)) revision = value.slice(0, 12);
    } catch {
      failed++;
    }
  }
  return { latenciesMs, revision, failed };
}

export async function collectDiagnosticReport(
  fetcher: typeof fetch = fetch,
  now: () => number = () => performance.now(),
): Promise<string> {
  const [server, desktopVersion] = await Promise.all([
    probeServer(fetcher, now),
    desktopBridge()?.update?.state().then((state) => state.currentVersion ?? null, () => null) ?? Promise.resolve(null),
  ]);
  return formatDiagnosticReport({
    generatedAt: new Date().toISOString(),
    webBuild: CLIENT_BUILD,
    desktopVersion,
    serverRevision: server.revision,
    latenciesMs: server.latenciesMs,
    failedProbes: server.failed,
    userAgent: navigator.userAgent.slice(0, 300),
    language: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    online: navigator.onLine,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
  });
}

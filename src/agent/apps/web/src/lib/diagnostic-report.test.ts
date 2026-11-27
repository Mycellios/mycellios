// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { collectDiagnosticReport, formatDiagnosticReport } from "./diagnostic-report";

describe("diagnostic report", () => {
  it("lists versions, server answers and platform in plain text", () => {
    const report = formatDiagnosticReport({
      generatedAt: "2026-11-27T09:00:00.000Z", webBuild: "20261127090000", desktopVersion: "0.36.0",
      serverRevision: "95931a6e764a", latenciesMs: [180.4, 120.2, 140], failedProbes: 1,
      userAgent: "UA", language: "es-ES", timeZone: "Europe/Madrid", online: true, viewport: "1424×861",
    });
    expect(report).toContain("App: Desktop 0.36.0");
    expect(report).toContain("Server revision: 95931a6e764a");
    expect(report).toContain("Server latency: 120 ms / 140 ms / 180 ms (median 140 ms), 1 failed");
    expect(report).toContain("Language: es-ES · Time zone: Europe/Madrid · Window: 1424×861");
  });

  it("probes the server three times and keeps only a revision-shaped value", async () => {
    let clock = 0;
    const fetcher = vi.fn(async () => {
      clock += 100;
      return new Response(JSON.stringify({ ok: true, revision: "1f198fa57bdfaf8873042910c78f8d24ea94a126" }));
    });
    const report = await collectDiagnosticReport(fetcher as unknown as typeof fetch, () => clock);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store", credentials: "omit" });
    expect(report).toContain("Server revision: 1f198fa57bdf");
    expect(report).toContain("App: browser");

    const odd = vi.fn(async () => new Response(JSON.stringify({ revision: "<script>" })));
    expect(await collectDiagnosticReport(odd as unknown as typeof fetch)).toContain("Server revision: unknown");
  });

  it("reports an unreachable server instead of failing", async () => {
    const down = vi.fn(async () => { throw new TypeError("offline"); });
    const report = await collectDiagnosticReport(down as unknown as typeof fetch);
    expect(report).toContain("Server latency: no answer, 3 failed");
  });
});

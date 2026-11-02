import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseStatsHistory, parseStatsSnapshot, statsOverview } from "./stats-model";
import { StatsDashboard } from "./StatsDashboard";
import type { NetworkSnapshot, NetworkTelemetryHistory } from "./NetworkPage";

const snapshot: NetworkSnapshot = { capturedAt: "2026-11-01T12:00:00Z", version: "test", summary: { registered: 1, connected: 1, online: 1, mobile: 0, offeredVramMb: 1024, completedJobs: 7 }, workers: [{ id: "fixture-worker", kind: "desktop", status: "online", connected: true, region: "auto", offeredVramMb: 1024, jobsCompleted: 7, reliability: 1, lastSeenAt: "2026-11-01T12:00:00Z", gpus: [], deployments: [] }], models: [{ id: "fixture-model", replicas: 1, pipelines: 0 }, { id: "unavailable-model", replicas: 0, pipelines: 0 }], jobs: [{ id: "fixture-job", model: "fixture-model", status: "completed", workerId: "fixture-worker", inputTokens: 5, outputTokens: 8, updatedAt: "2026-11-01T12:00:00Z" }] };
const history: NetworkTelemetryHistory = { capturedAt: snapshot.capturedAt, intervalMinutes: 10, retentionDays: 90, range: "30d", samples: [{ capturedAt: snapshot.capturedAt, registeredNodes: 1, connectedNodes: 1, onlineNodes: 1, browserNodes: 0, activeModels: 1, modelReplicas: 1, modelPipelines: 0, offeredVramMb: 1024, freeVramMb: 0, inflightJobs: 0, runningJobs: 0, completedJobs: 7 }] };
describe("public Stats provenance", () => {
  it("derives model capacity and recent usage without inventing geographic pins", () => {
    expect(parseStatsSnapshot(snapshot)).toBe(snapshot);
    expect(statsOverview(snapshot)).toMatchObject({ activeJobs: 0, servingModels: 1, located: 0, modelRows: [{ id: "fixture-model", replicas: 1, pipelines: 0, recentTokens: 13 }, { id: "unavailable-model", replicas: 0, pipelines: 0, recentTokens: 0 }] });
  });
  it("rejects corrupt or non-finite observations instead of drawing fake zeros", () => {
    expect(() => parseStatsSnapshot({ ...snapshot, summary: { ...snapshot.summary, connected: Infinity } })).toThrow();
    expect(() => parseStatsSnapshot({ ...snapshot, models: [{ id: "bad", replicas: -1, pipelines: 0 }] })).toThrow();
    expect(() => parseStatsHistory({ ...history, range: "7d" }, "30d")).toThrow();
    expect(parseStatsHistory(history, "30d")).toBe(history);
  });
  it("renders real small counts, zero capacity and private console links without revenue claims", () => {
    const html = renderToStaticMarkup(<StatsDashboard initialSnapshot={snapshot} initialHistory={history} />);
    expect(html).toContain("Mycellios Stats"); expect(html).toContain("fixture-model");
    expect(html).toContain("fixture-worker"); expect(html).toContain("Not announced");
    expect(html).toContain("0 GB"); expect(html).toContain("1 persisted observations");
    expect(html).toContain("/dashboard?view=overview"); expect(html).not.toContain("$343");
  });
});

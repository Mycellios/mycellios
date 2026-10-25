import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NetworkHistoryReport } from "./Panel";

describe("NetworkHistoryReport", () => {
  it("renders persisted capacity changes and exact samples", () => {
    const history = {
      capturedAt: "2026-07-25T12:20:00.000Z",
      intervalMinutes: 10,
      retentionDays: 90,
      range: "24h",
      samples: [
        sample("2026-07-25T12:00:00.000Z", {
          connectedNodes: 2,
          onlineNodes: 2,
          activeModels: 1,
          offeredVramMb: 24_576,
          freeVramMb: 16_384,
        }),
        sample("2026-07-25T12:10:00.000Z", {
          connectedNodes: 3,
          onlineNodes: 3,
          activeModels: 2,
          offeredVramMb: 40_960,
          freeVramMb: 28_672,
          inflightJobs: 2,
          runningJobs: 1,
        }),
      ],
    } satisfies Parameters<typeof NetworkHistoryReport>[0]["history"];

    const html = renderToStaticMarkup(<NetworkHistoryReport history={history} compact={false} />);

    expect(html).toContain("Latest sample");
    expect(html).toContain("40 GB");
    expect(html).toContain("28 GB");
    expect(html).toContain("+16384 since start");
    expect(html).toContain("Latest saved readings");
    expect(html).toContain("<polyline");

    const compact = renderToStaticMarkup(<NetworkHistoryReport history={history} />);
    const initialCharts = compact.split("<details")[0] ?? "";
    expect(initialCharts.match(/class="ui-card network-history-chart"/g)).toHaveLength(2);
    expect(compact).not.toContain('class="network-history-summary"');
    expect(compact).not.toContain('open=""');
    expect(compact).toContain("Latest saved readings");
  });
});

function sample(
  capturedAt: string,
  overrides: Partial<Parameters<typeof NetworkHistoryReport>[0]["history"]["samples"][number]>,
): Parameters<typeof NetworkHistoryReport>[0]["history"]["samples"][number] {
  return {
    capturedAt,
    registeredNodes: 3,
    connectedNodes: 0,
    onlineNodes: 0,
    browserNodes: 0,
    activeModels: 0,
    modelReplicas: 0,
    modelPipelines: 0,
    offeredVramMb: 0,
    freeVramMb: 0,
    inflightJobs: 0,
    runningJobs: 0,
    completedJobs: 0,
    ...overrides,
  };
}

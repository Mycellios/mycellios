import { describe, expect, it } from "vitest";
import { presentEngineUpdate } from "./engine-update-presentation";

const release = { engine: "claude" as const, version: "2.1.332", current: "2.1.330", source: "npm" as const, package: "@anthropic-ai/claude-code", bytes: 200_000_000 };

describe("presentEngineUpdate", () => {
  it("offers a newer version with both versions named", () => {
    expect(presentEngineUpdate({ engine: "claude", release, wasRunning: false })).toMatchObject({
      stage: "available", versions: "v2.1.330 → v2.1.332", offer: "2.1.332", percent: null,
    });
  });

  it("reports download progress from the PC's bytes, then the final check without a percentage", () => {
    const downloading = presentEngineUpdate({ engine: "claude", release, wasRunning: false,
      progress: { engine: "claude", state: "downloading", receivedBytes: 78_000_000, totalBytes: 200_000_000 } });
    expect(downloading).toMatchObject({ stage: "running", versions: "v2.1.330 → v2.1.332", percent: 39, checking: false, offer: null });
    const checking = presentEngineUpdate({ engine: "claude", wasRunning: true, target: { current: "2.1.330", version: "2.1.332" },
      progress: { engine: "claude", state: "checking" } });
    expect(checking).toMatchObject({ stage: "running", versions: "v2.1.330 → v2.1.332", percent: null, checking: true });
  });

  it("uses the offered size when the PC has not reported a total yet", () => {
    expect(presentEngineUpdate({ engine: "claude", release, wasRunning: false,
      progress: { engine: "claude", state: "downloading", receivedBytes: 100_000_000 } })?.percent).toBe(50);
  });

  it("shows a failure with its reason and offers the same version again", () => {
    expect(presentEngineUpdate({ engine: "claude", release, wasRunning: true,
      progress: { engine: "claude", state: "failed", error: "The download did not match its published hash." } })).toMatchObject({
      stage: "failed", error: "The download did not match its published hash.", offer: "2.1.332",
    });
  });

  it("says it is done only after this window saw it running", () => {
    expect(presentEngineUpdate({ engine: "claude", wasRunning: true, target: { current: "2.1.330", version: "2.1.332" } }))
      .toMatchObject({ stage: "done", versions: "v2.1.332" });
    expect(presentEngineUpdate({ engine: "claude", wasRunning: false })).toBeNull();
  });
});

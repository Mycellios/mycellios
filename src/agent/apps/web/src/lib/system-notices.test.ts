import { describe, expect, it } from "vitest";
import {
  OFFLINE_CLOUD_NOTICE,
  offlineEngineFallbackNotice,
} from "../../../../packages/adapters/src/offline-cloud-workspace";
import { parseSystemNotice } from "./system-notices";

describe("server chat notes", () => {
  it("recognises the offline-PC notes exactly as the server writes them", () => {
    expect(parseSystemNotice(OFFLINE_CLOUD_NOTICE)).toEqual({ kind: "offline-cloud" });
    expect(parseSystemNotice(offlineEngineFallbackNotice("claude"))).toEqual({ kind: "offline-engine", engine: "Claude Code" });
    expect(parseSystemNotice(offlineEngineFallbackNotice("acp"))).toEqual({ kind: "offline-engine", engine: "the PC's agent" });
  });

  it("leaves other notes alone", () => {
    expect(parseSystemNotice("Context was reset.")).toBeNull();
  });
});

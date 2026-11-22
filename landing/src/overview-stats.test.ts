import { describe, expect, it } from "vitest";
import {
  deviceHardware,
  deviceRows,
  hourlyCompletedTasks,
  modelDisplayName,
  modelKind,
  modelRows,
  onlineGpuCapacity,
  recentTaskOutcome,
  type StatsSnapshot,
  type StatsWorker,
} from "./overview-stats";

const worker = (id: string, gpus: StatsWorker["gpus"], deployments: StatsWorker["deployments"] = [], connected = true, kind = "node"): StatsWorker => ({
  id, kind, status: connected ? "online" : "offline", connected, lastSeenAt: "2026-11-22T10:00:00.000Z", agentVersion: "0.2.124", gpus, deployments,
});

describe("model presentation", () => {
  it.each([
    ["mycellios-kokoro-es", "Kokoro (español)"],
    ["mycellios-whisper-small", "Whisper Small"],
    ["agent-credit-lab-qwen3-1.7b", "Qwen3 1.7B"],
    ["mycellios-qwen3-embedding-4b", "Qwen3 Embedding 4B"],
    ["jev", "Jev"],
    ["qa-qwen-embedding-gpu-20261020-3ba86b0f", "Qa Qwen Embedding GPU"],
  ])("names %s as %s", (id, name) => expect(modelDisplayName(id)).toBe(name));

  it("classifies by runtime adapter first, then by id", () => {
    expect(modelKind("anything", ["kokoro"])).toBe("voice");
    expect(modelKind("mycellios-whisper-small", ["transcription"])).toBe("transcription");
    expect(modelKind("mycellios-qwen3-embedding-4b")).toBe("embeddings");
    expect(modelKind("jev")).toBe("decisions");
    expect(modelKind("agent-credit-lab-qwen3-1.7b", ["mycellios-pipeline"])).toBe("chat");
  });
});

describe("overview statistics", () => {
  const snapshot: StatsSnapshot = {
    summary: { registered: 4, online: 3, completedJobs: 10 },
    workers: [
      worker("a", [{ vendor: "nvidia", model: "NVIDIA GeForce RTX 2060", offeredVramMb: 6144 }], [{ model: "chat-model", adapter: "mycellios-pipeline" }]),
      worker("b", [{ vendor: "cpu", model: "CPU · system-memory fallback", offeredVramMb: 2048 }], [{ model: "mycellios-kokoro-es", adapter: "kokoro" }]),
      worker("c", [{ vendor: "mycellios", model: "Native pipeline capacity for jev", offeredVramMb: 8192 }], [{ model: "jev", adapter: "decision" }], true, "cell"),
      worker("d", [{ vendor: "nvidia", model: "NVIDIA GeForce RTX 3090", offeredVramMb: 24576 }], [], false),
    ],
    models: [{ id: "chat-model", replicas: 1, pipelines: 0 }, { id: "mycellios-kokoro-es", replicas: 1, pipelines: 0 }, { id: "jev", replicas: 0, pipelines: 1 }],
    requestedModels: [{ id: "mycellios-kokoro-es", status: "active" }, { id: "queued-embedding", status: "profiling" }, { id: "big-model", status: "waiting_capacity" }, { id: "broken", status: "failed" }],
    jobs: [
      { id: "1", model: "jev", status: "completed", createdAt: "2026-11-22T10:00:00.000Z", updatedAt: "2026-11-22T10:00:01.000Z" },
      { id: "2", model: "jev", status: "failed", createdAt: "2026-11-22T09:50:00.000Z", updatedAt: "2026-11-22T09:50:01.000Z" },
      { id: "3", model: "chat-model", status: "running", createdAt: "2026-11-22T10:01:00.000Z", updatedAt: "2026-11-22T10:01:00.000Z" },
    ],
  };

  it("counts only physical graphics cards on online devices as shared GPU memory", () => {
    expect(onlineGpuCapacity(snapshot.workers)).toEqual({ gpus: 1, sharedMb: 6144, devices: 1 });
  });

  it("maps requested model states to plain service states", () => {
    const rows = modelRows(snapshot);
    expect(rows.map((row) => [row.id, row.state, row.nodes, row.recentTasks])).toEqual([
      ["jev", "serving", 1, 2],
      ["chat-model", "serving", 1, 1],
      ["mycellios-kokoro-es", "serving", 1, 0],
      ["queued-embedding", "preparing", 0, 0],
      ["big-model", "no_capacity", 0, 0],
      ["broken", "unavailable", 0, 0],
    ]);
    expect(rows[0]).toMatchObject({ name: "Jev", kind: "decisions" });
  });

  it("describes devices by hardware class without exposing private fields", () => {
    expect(snapshot.workers.map(deviceHardware)).toEqual(["NVIDIA GeForce RTX 2060", "CPU", "Capacidad nativa", "NVIDIA GeForce RTX 3090"]);
    const rows = deviceRows(snapshot.workers);
    expect(rows.at(-1)).toMatchObject({ id: "d", status: "offline", online: false, kind: "Nodo" });
    expect(Object.keys(rows[0]!).sort()).toEqual(["hardware", "id", "kind", "lastSeenAt", "online", "status", "version"]);
  });

  it("summarizes how the latest tasks ended", () => {
    expect(recentTaskOutcome(snapshot.jobs)).toEqual({ total: 3, completed: 1, failed: 1, inProgress: 1, since: Date.parse("2026-11-22T09:50:00.000Z") });
  });

  it("derives hourly completed tasks from the cumulative history counter", () => {
    const now = Date.parse("2026-11-22T12:30:00.000Z");
    const samples = Array.from({ length: 146 }, (_, index) => ({
      capturedAt: new Date(now - (145 - index) * 600_000).toISOString(),
      completedJobs: 1_000 + index * 2 - (index === 100 ? 50 : 0),
    }));
    const activity = hourlyCompletedTasks(samples, now);
    expect(activity.hours).toHaveLength(24);
    expect(activity.fullDay).toBe(true);
    expect(activity.hours.every((hour) => hour.completed >= 0)).toBe(true);
    expect(activity.completed).toBe(activity.hours.reduce((total, hour) => total + hour.completed, 0));
    expect(hourlyCompletedTasks(samples.slice(-6), now)).toMatchObject({ fullDay: false });
    expect(hourlyCompletedTasks([], now)).toMatchObject({ completed: 0, coverageStart: null, fullDay: false });
  });
});

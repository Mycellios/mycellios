import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { Overview } from "../Panel";

type Snapshot = ComponentProps<typeof Overview>["snapshot"];
// A fixed clock keeps the fixture's relative times and chart stable across renders.
const NOW = Date.parse("2026-11-22T18:40:00.000Z");
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const worker = (id: string, kind: string, gpus: Snapshot["workers"][number]["gpus"], deployments: Snapshot["workers"][number]["deployments"], connected = true, minutesAgo = 0, version = "0.2.124") => ({
  id, kind, status: connected ? "online" as const : "offline" as const, connected, lastSeenAt: at(minutesAgo), agentVersion: version, gpus, deployments,
});
const gpu = (vendor: string, model: string, offeredVramMb: number) => ({ vendor, model, offeredVramMb });
const snapshot: Snapshot = {
  capturedAt: new Date(NOW).toISOString(),
  summary: { registered: 9, online: 6, completedJobs: 60_701 },
  workers: [
    worker("node-preview-rtx", "node", [gpu("nvidia", "NVIDIA GeForce RTX 2060", 6143)], [{ model: "agent-credit-lab-qwen3-1.7b", adapter: "mycellios-pipeline" }]),
    worker("node-preview-iris", "node", [gpu("intel", "Intel(R) Iris(R) Xe Graphics", 7374)], []),
    worker("node-preview-cpu-a", "node", [gpu("cpu", "CPU · system-memory fallback", 2048)], [{ model: "mycellios-kokoro-es", adapter: "kokoro" }], true, 0, "0.2.123"),
    worker("node-preview-cpu-b", "node", [gpu("cpu", "CPU · system-memory fallback", 2048)], [{ model: "mycellios-kokoro-es", adapter: "kokoro" }], true, 0, "0.2.123"),
    worker("cell-preview-whisper", "cell", [gpu("mycellios", "Native pipeline capacity", 2048)], [{ model: "mycellios-whisper-small", adapter: "transcription" }]),
    worker("cell-preview-jev", "cell", [gpu("mycellios", "Native pipeline capacity", 8192)], [{ model: "jev", adapter: "decision" }]),
    worker("node-preview-old", "node", [gpu("nvidia", "NVIDIA GeForce RTX 2060", 4096)], [], false, 60 * 24 * 42, "0.2.70"),
    worker("node-preview-laptop", "node", [gpu("cpu", "CPU · system-memory fallback", 4096)], [], false, 11, "0.2.95"),
    worker("node-preview-gtx", "node", [gpu("nvidia", "NVIDIA GeForce GTX 850M", 1701)], [], false, 60 * 5, "0.2.108"),
  ],
  models: [
    { id: "mycellios-kokoro-es", replicas: 2, pipelines: 0 },
    { id: "mycellios-whisper-small", replicas: 1, pipelines: 0 },
    { id: "jev", replicas: 0, pipelines: 1 },
    { id: "agent-credit-lab-qwen3-1.7b", replicas: 1, pipelines: 0 },
  ],
  requestedModels: [
    { id: "mycellios-qwen3-embedding-4b", status: "profiling" },
    { id: "smollm2-360m-instruct", status: "waiting_capacity" },
  ],
  jobs: Array.from({ length: 100 }, (_, index) => ({
    id: `job-${index}`,
    model: ["mycellios-kokoro-es", "mycellios-whisper-small", "jev", "agent-credit-lab-qwen3-1.7b"][index % 4]!,
    status: index === 0 ? "running" : index % 5 === 0 ? "failed" : "completed",
    createdAt: at(index * 0.3), updatedAt: at(index * 0.3),
  })),
};
type Sample = { capturedAt: string; completedJobs: number; failedJobs?: number | null };
/** Cumulative history; failures are only measured for the last `failedForMinutes`, as after the coordinator update. */
const history = (failedForMinutes: number) => Array.from({ length: 145 }, (_, index) => {
  const minutesAgo = (144 - index) * 10;
  const hour = new Date(NOW - minutesAgo * 60_000).getUTCHours();
  const perSample = 18 + Math.round(14 * Math.sin((hour / 24) * Math.PI * 2)) + (index % 3);
  const failedPerSample = (index % 4 === 0 ? 1 : 0) + (hour === 15 ? 3 : 0);
  return { capturedAt: at(minutesAgo), minutesAgo, perSample, failedPerSample };
}).reduce<Sample[]>((list, sample) => {
  const previous = list.at(-1);
  const measured = sample.minutesAgo <= failedForMinutes;
  list.push({
    capturedAt: sample.capturedAt,
    completedJobs: (previous?.completedJobs ?? 56_000) + sample.perSample,
    ...(measured ? { failedJobs: (previous?.failedJobs ?? 1_200) + sample.failedPerSample } : {}),
  });
  return list;
}, []);
const samples = history(9 * 60);
const fullDaySamples = history(24 * 60);
const empty: Snapshot = { ...snapshot, summary: { registered: 0, online: 0, completedJobs: 0 }, workers: [], models: [], requestedModels: [], jobs: [] };
const meta = {
  title: "Screens/Overview", component: Overview, parameters: { layout: "fullscreen" },
  args: { snapshot, connectionError: null, onAddDevice: () => {}, now: NOW, loadHistory: async () => samples },
  render: (args) => <Overview {...args} />,
} satisfies Meta<typeof Overview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Empty: Story = { args: { snapshot: empty, loadHistory: async () => [] } };
export const Waiting: Story = { args: { snapshot: { ...empty, capturedAt: new Date(0).toISOString() }, connectionError: "Coordinator unavailable" } };
export const Stale: Story = { args: { snapshot: { ...snapshot, capturedAt: new Date(NOW - 120_000).toISOString() }, connectionError: "Coordinator unavailable" } };
/** Failed tasks measured for the whole day. */
export const FailuresFullDay: Story = { args: { loadHistory: async () => fullDaySamples } };
/** History recorded before the coordinator measured failures: every hour reads "sin datos". */
export const FailuresNotMeasured: Story = { args: { loadHistory: async () => history(-1) } };
export const HistoryUnavailable: Story = { args: { loadHistory: async () => { throw new Error("offline"); } } };

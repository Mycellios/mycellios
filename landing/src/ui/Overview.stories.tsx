import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { Overview } from "../Panel";

type Snapshot = ComponentProps<typeof Overview>["snapshot"];
const snapshot: Snapshot = {
  capturedAt: new Date().toISOString(), version: "preview", buildIdentity: null,
  summary: { registered: 1, connected: 1, online: 1, mobile: 0, offeredVramMb: 8192, completedJobs: 12 },
  workers: [{
    id: "preview-device", kind: "desktop", status: "online", connected: true, region: "preview",
    offeredVramMb: 8192, reliability: 1, jobsCompleted: 12, lastSeenAt: new Date().toISOString(), quarantined: false, quarantineExpiresAt: null,
    gpus: [{ id: "preview-gpu", vendor: "preview", model: "Preview GPU", physicalVramMb: 8192, offeredVramMb: 8192, freeOfferedVramMb: 4096 }],
    deployments: [{ deploymentId: "preview-deployment", model: "example-model", mode: "replica", freeSlots: 1, tokensPerSecond: 0 }],
  }],
  models: [{ id: "example-model", replicas: 1, pipelines: 0 }], requestedModels: [], jobs: [], recentNetworkTraces: [],
};
const empty: Snapshot = { ...snapshot, summary: { registered: 0, connected: 0, online: 0, mobile: 0, offeredVramMb: 0, completedJobs: 0 }, workers: [], models: [] };
const meta = {
  title: "Screens/Overview", component: Overview, parameters: { layout: "fullscreen" },
  args: { snapshot, connectionError: null, onNavigate: () => {}, publicLink: (path: string) => path, external: false, apiBaseUrl: "https://api.example.test/v1", earnUrl: "https://example.test/earn", developerMode: false, theme: "light" },
  render: (args, context) => <Overview {...args} theme={context.globals.theme === "dark" ? "dark" : "light"} snapshot={{ ...args.snapshot, capturedAt: context.parameters.fixedEvidence ? args.snapshot.capturedAt : new Date().toISOString() }} />,
} satisfies Meta<typeof Overview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Empty: Story = { args: { snapshot: empty } };
export const Waiting: Story = { parameters: { fixedEvidence: true }, args: { snapshot: { ...empty, capturedAt: new Date(0).toISOString() }, connectionError: "Coordinator unavailable" } };
export const Stale: Story = { parameters: { fixedEvidence: true }, args: { snapshot: { ...snapshot, capturedAt: new Date(Date.now() - 120_000).toISOString() }, connectionError: "Coordinator unavailable" } };
export const ManyModels: Story = { args: { snapshot: { ...snapshot, models: Array.from({ length: 8 }, (_, index) => ({ id: `example-model-${index + 1}`, replicas: 1, pipelines: 0 })) } } };

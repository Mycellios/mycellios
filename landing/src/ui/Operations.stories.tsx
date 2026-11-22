import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { AssistantAdmin, Jobs, Models, NetworkHistoryReport, Nodes, SystemLogs, Tests } from "../Panel";

const meta = { title: "Screens/Operations", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const snapshot: ComponentProps<typeof Nodes>["snapshot"] = {
  capturedAt: "2026-10-20T12:00:00.000Z", version: "preview", buildIdentity: null,
  summary: { registered: 0, connected: 0, online: 0, mobile: 0, offeredVramMb: 0, completedJobs: 0 },
  workers: [], models: [], requestedModels: [], jobs: [], recentNetworkTraces: [],
};
const noop = async () => {};
const noCredentials = async () => [];
const emptyCatalog = async () => ({ data: [], nextCursor: null });
const noBenchmarks = async () => [];
const history: ComponentProps<typeof NetworkHistoryReport>["history"] = {
  capturedAt: "2026-10-20T12:20:00.000Z", intervalMinutes: 10, retentionDays: 90, range: "24h",
  samples: [0, 1, 2].map(index => ({
    capturedAt: `2026-10-20T12:${index}0:00.000Z`, registeredNodes: 8,
    connectedNodes: 5 + index, onlineNodes: 5 + index, browserNodes: 2,
    activeModels: 2, modelReplicas: 3, modelPipelines: 1,
    offeredVramMb: 24_576 + index * 4_096, freeVramMb: 20_480 + index * 4_096,
    inflightJobs: index, runningJobs: index, completedJobs: 100 + index * 12,
  })),
};

export const NodeManagement: Story = { render: () => <Nodes snapshot={snapshot} onRemove={noop} onClearOffline={noop} onListCredentials={noCredentials} onRevokeCredential={noop} /> };
export const ModelManagement: Story = { render: () => <Models snapshot={snapshot} onSearch={emptyCatalog} onRequest={noop} onRemove={noop} adminToken="" requiresAdminToken secureTokenStorage={false} /> };
export const Tasks: Story = { render: () => <Jobs snapshot={snapshot} /> };
export const Logs: Story = { render: () => <SystemLogs snapshot={snapshot} connectionError="Preview: coordinator disconnected" /> };
export const Benchmarks: Story = { render: () => <Tests canRunLocally={false} loadBenchmarkRuns={noBenchmarks} /> };
export const NetworkHistory: Story = { render: () => <section className="minimal-screen"><NetworkHistoryReport history={history} /></section> };
export const Administration: Story = { render: () => <AssistantAdmin apiOrigin="" adminToken="" authSession={null} onAdminTokenChange={() => {}} /> };

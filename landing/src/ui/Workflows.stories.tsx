import type { Meta, StoryObj } from "@storybook/react-vite";
import { Contribute } from "../Contribute";

const meta = { title: "Screens/Workflows", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const noop = () => {};
const session = async () => null;
export const Run: Story = { render: () => <Contribute accessToken={null} authConfig={{ enabled: false }} authSession={null} getValidSession={session} onSessionElevated={noop} onSignIn={noop} onOpenAccount={noop} onNavigate={noop} network={{ connectedNodes: 0, completedJobs: 0, traceCount: 0 }} /> };

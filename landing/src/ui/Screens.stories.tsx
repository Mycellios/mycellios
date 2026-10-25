import type { Meta, StoryObj } from "@storybook/react-vite";
import { AccountModal } from "../Panel";
import { DownloadsPage } from "../Downloads";
import type { PublicDownloadAvailability } from "../../../src/contracts/public-downloads";
import { Heading } from "./primitives";

const meta = { title: "Screens/Production", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const unavailable: PublicDownloadAvailability = {
  schema: "mycellios-public-downloads/1", version: "preview",
  packages: [
    { id: "windows-x64", label: "Windows", format: "ZIP", fileName: "preview.zip", path: "/downloads/preview.zip", available: false },
    { id: "macos-arm64", label: "macOS", format: "TAR.GZ", fileName: "preview.tar.gz", path: "/downloads/preview.tar.gz", available: false },
    { id: "linux-x64", label: "Linux", format: "TAR.GZ", fileName: "preview-linux.tar.gz", path: "/downloads/preview-linux.tar.gz", available: false },
  ],
};
const unavailableLoader = async () => unavailable;
const failedLoader = async (): Promise<PublicDownloadAvailability> => { throw new Error("Preview: unavailable"); };

export const Account: Story = {
  render: () => <AccountModal config={{ enabled: false }} onConfigLoaded={() => {}} getValidSession={async () => null} session={null} identity={null} account={null} onAuthenticated={() => {}} onRetryRole={async () => {}} onSignOut={() => {}} onClose={() => {}} />,
};
export const AccountLoading: Story = {
  render: () => <AccountModal ready={false} config={{ enabled: false }} onConfigLoaded={() => {}} getValidSession={async () => null} session={null} identity={null} account={null} onAuthenticated={() => {}} onRetryRole={async () => {}} onSignOut={() => {}} onClose={() => {}} />,
};
export const Downloads: Story = { render: () => <DownloadsPage title={<Heading as="h1">Downloads</Heading>} publicLink={path => path} external={false} loadAvailability={unavailableLoader} /> };
export const DownloadsError: Story = { render: () => <DownloadsPage title={<Heading as="h1">Downloads</Heading>} publicLink={path => path} external={false} loadAvailability={failedLoader} /> };

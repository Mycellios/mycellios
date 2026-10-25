import type { Meta, StoryObj } from "@storybook/react-vite";
import { Cpu, Radio } from "lucide-react";
import { useState } from "react";
import { CapacityMetric, Empty as EmptyPanel, Metric, PageTitle, PanelDisclosure, PanelLoading, Stat, SummaryStrip } from "./patterns";
import { TablePagination } from "./TablePagination";
import { Alert, Badge, Button, Card, DialogPanel, Disclosure, DisclosureSummary, EmptyState, Heading, Link, Separator, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Text } from "./primitives";

const meta = { title: "Kit/Content", component: Card, tags: ["autodocs"] } satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Panel: Story = { render: () => <Card style={{ padding: 24, border: "1px solid var(--ui-line)", borderRadius: 18 }}><Heading>Connected devices</Heading><Text>Real production primitives, shared by every surface.</Text><Link href="#devices">View devices</Link></Card> };
export const Typography: Story = { render: () => <><Heading as="h1">Page heading</Heading><Heading>Section heading</Heading><Heading as="h3">Card heading</Heading><Text>Body text</Text><Text as="small">Supporting text</Text></> };
export const Statuses: Story = { render: () => <div style={{ display: "flex", gap: 12 }}>{(["neutral", "success", "warning", "danger"] as const).map(tone => <Badge key={tone} tone={tone}>{tone}</Badge>)}</div> };
export const Feedback: Story = { render: () => <div style={{ display: "grid", gap: 12 }}><Alert tone="danger">Connection failed. Try again.</Alert><Alert tone="warning">Waiting for a model.</Alert><Alert tone="success">Connected.</Alert></div> };
export const Empty: Story = { render: () => <EmptyState title="No models available" action={<Button variant="primary">View models</Button>}>Connect a device to get started.</EmptyState> };
export const Loading: Story = { render: () => <PanelLoading /> };
export const PanelEmpty: Story = { render: () => <EmptyPanel icon={Cpu} title="No devices" copy="Connect a device to see its capacity." /> };
export const InlineMetric: Story = { render: () => <Metric label="Online" value="7" /> };
export const PageHeader: Story = { render: () => <PageTitle title="Your devices" actions={<Button variant="primary">Connect device</Button>} /> };
export const Metrics: Story = { render: () => <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 20 }}><Stat icon={Radio} label="Connected nodes" value="7" detail="Live snapshot" /><CapacityMetric icon={Cpu} label="Runtime stages" value="3" detail="CPU + CUDA" /></div> };
export const Collapsible: Story = { render: () => <PanelDisclosure icon={Cpu} eyebrow="CAPACITY" title="Device details" summary="Runtime and memory"><Text>Loaded runtime information.</Text></PanelDisclosure> };
export const NativeDisclosure: Story = { render: () => <Disclosure><DisclosureSummary>Advanced options</DisclosureSummary><Text>Optional configuration.</Text></Disclosure> };
export const DataTable: Story = { render: function Demo() { const [page, setPage] = useState(0); return <><Table><TableHead><TableRow><TableHeader>Device</TableHeader><TableHeader>Status</TableHeader></TableRow></TableHead><TableBody><TableRow><TableCell>Device {page + 1}</TableCell><TableCell><Badge tone="success">Connected</Badge></TableCell></TableRow></TableBody></Table><TablePagination label="devices" page={page} pageCount={3} total={21} onPageChange={setPage} /></>; } };
export const Dialog: Story = { render: () => <DialogPanel role="dialog" aria-labelledby="dialog-heading" className="account-modal" style={{ position: "relative", margin: "auto" }}><Heading id="dialog-heading">Welcome back</Heading><Text>Sign in to your account.</Text><Separator /><Button variant="primary">Sign in securely</Button></DialogPanel> };

export const Summary: Story = { render: () => <SummaryStrip items={[{ label: "Devices", value: "7" }, { label: "Memory", value: "24 GB" }, { label: "Requests", value: "2" }]} /> };

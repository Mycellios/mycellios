import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowRight, Download, Settings } from "lucide-react";
import { Button, IconButton, Link } from "./primitives";

const meta = { title: "Kit/Button", component: Button, tags: ["autodocs"], args: { children: "Continue", variant: "primary" }, argTypes: { variant: { control: "select", options: ["primary", "secondary", "ghost", "danger", "navigation"] }, size: { control: "select", options: ["sm", "md", "lg", "xl"] } } } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Primary: Story = {};
export const SpaciousAction: Story = { args: { size: "xl", children: "Explore the network" } };
export const Secondary: Story = { args: { variant: "secondary" } };
export const Ghost: Story = { args: { variant: "ghost" } };
export const Destructive: Story = { args: { variant: "danger", children: "Revoke access" } };
export const Disabled: Story = { args: { disabled: true } };
export const Loading: Story = { args: { loading: true, children: "Connecting" } };
export const WithIcon: Story = { render: (args) => <Button {...args}><Download size={16} />Download</Button> };
export const AccountSubmit: Story = { render: () => <Button type="submit" className="account-submit" variant="primary" style={{ width: 360 }}><span>Sign in securely</span><ArrowRight size={17} /></Button> };
export const IconOnly: Story = { render: () => <IconButton aria-label="Settings" variant="secondary"><Settings size={18} /></IconButton> };
export const LinkAction: Story = { render: () => <Link href="#downloads" variant="primary">Download app <Download size={16} /></Link> };
export const Sizes: Story = { render: () => <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>{(["sm", "md", "lg", "xl"] as const).map(size => <Button key={size} variant="primary" size={size}>{size}</Button>)}</div> };

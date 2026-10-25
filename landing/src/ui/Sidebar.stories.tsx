import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { Download, History, LayoutDashboard, Zap } from "lucide-react";
import { EarnQuickMenu } from "../EarnQuickMenu";
import { AgentNavigationLink, Sidebar, SidebarFooter } from "./Sidebar";
import { Button, Heading, Text } from "./primitives";

const meta = { title: "Kit/Sidebar", component: Sidebar, args: { collapsed: false, onToggle: () => {}, onClose: () => {}, homeHref: "#home", logoSrc: "/assets/brand/favicon.png", children: null }, parameters: { layout: "fullscreen", ownsThemeRoot: true }, tags: ["autodocs"] } satisfies Meta<typeof Sidebar>;
export default meta;
type Story = StoryObj<typeof meta>;

function SidebarExample({ initiallyCollapsed = false, signedIn = false, initialTheme = "light" }: { initiallyCollapsed?: boolean; signedIn?: boolean; initialTheme?: "light" | "dark" }) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
  useEffect(() => setTheme(initialTheme), [initialTheme]);
  const [view, setView] = useState("Overview");
  return <div className={`public-panel theme-${theme}${collapsed ? " sidebar-collapsed" : ""}`}>
    <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(value => !value)} onClose={() => {}} homeHref="#home" logoSrc="/assets/brand/favicon.png">
      <nav id="panel-sidebar-links">{[["Overview", LayoutDashboard], ["History", History], ["Run", Zap], ["Downloads", Download]].map(([label, Icon]) => {
        const Glyph = Icon as typeof Download;
        const name = label as string;
        return <Button key={name} variant="navigation" className={view === name ? "active" : ""} aria-label={name} title={name} aria-current={view === name ? "page" : undefined} onClick={() => setView(name)}><Glyph size={18} /><span>{name}</span></Button>;
      })}<AgentNavigationLink /></nav>
      <SidebarFooter accountLabel={signedIn ? "Daniel" : "Sign in"} accountTitle={signedIn ? "Open account" : "Sign in to Mycellios"} onAccount={() => {}} theme={theme} onTheme={() => setTheme(value => value === "light" ? "dark" : "light")} status="Connected" degraded={false} version="0.2.77" earnMenu={<EarnQuickMenu earnUrl="#earn" browserUrl="#browser" downloadsUrl="#downloads" external={false} onOpenEarn={() => {}} />} />
    </Sidebar>
    <div className="panel-main" style={{ padding: 40 }}><Heading as="h1">{view}</Heading><Text>Toggle the sidebar to inspect alignment and motion. The navigation and footer are the production components.</Text></div>
  </div>;
}
export const Expanded: Story = { render: (_args, context) => <SidebarExample initialTheme={context.globals.theme === "dark" ? "dark" : "light"} /> };
export const Collapsed: Story = { render: (_args, context) => <SidebarExample initialTheme={context.globals.theme === "dark" ? "dark" : "light"} initiallyCollapsed /> };
export const SignedIn: Story = { render: (_args, context) => <SidebarExample initialTheme={context.globals.theme === "dark" ? "dark" : "light"} signedIn /> };

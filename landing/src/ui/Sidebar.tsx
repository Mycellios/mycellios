import type { ReactNode, Ref } from "react";
import { Bot, PanelLeftClose, PanelLeftOpen, SunMoon, UserRound, X } from "lucide-react";
import { Button, Link } from "./primitives";

export function Sidebar({ collapsed, open = false, inert = false, onToggle, onClose, closeButtonRef, homeHref, logoSrc, children }: {
  collapsed: boolean; open?: boolean; inert?: boolean; onToggle: () => void;
  onClose: () => void; closeButtonRef?: Ref<HTMLButtonElement>;
  homeHref: string; logoSrc: string; children: ReactNode;
}) {
  return <aside id="panel-navigation" className={open ? "panel-sidebar open" : "panel-sidebar"} aria-label="Primary navigation" inert={inert} data-ui="sidebar">
    <Button ref={closeButtonRef} type="button" className="panel-sidebar-close" aria-label="Close navigation" onClick={onClose}><X size={18} /></Button>
    <Link className="panel-brand" href={homeHref} aria-label="Mycellios home"><img src={logoSrc} alt="" /><div><strong>Mycellios</strong></div></Link>
    <Button type="button" className="panel-sidebar-toggle" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} aria-controls="panel-sidebar-links" onClick={onToggle}>
      {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
    </Button>
    {children}
  </aside>;
}

export function AgentNavigationLink() {
  return <Link variant="navigation" href="https://www.mycellios.com/agent" aria-label="Mycellios Agent" title="Mycellios Agent"><Bot size={18} /><span>Mycellios Agent</span></Link>;
}

export function SidebarFooter({ accountLabel, accountTitle, onAccount, theme, onTheme, status, degraded, version, earnMenu }: {
  accountLabel: string; accountTitle: string; onAccount: () => void;
  theme: "light" | "dark"; onTheme: () => void; status: string;
  degraded: boolean; version: string; earnMenu: ReactNode;
}) {
  return <div className="panel-sidebar-footer compact-footer" data-ui="sidebar-footer">
    <div className="panel-top-actions panel-sidebar-actions">
      <Button className="panel-theme-indicator" type="button" onClick={onTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}><SunMoon size={16} /></Button>
      {earnMenu}
    </div>
    <Button type="button" className="panel-sidebar-account" onClick={onAccount} aria-label={accountTitle} title={accountTitle}><UserRound size={16} /><span><strong>{accountLabel}</strong></span></Button>
    <div className="panel-sidebar-meta">
      <div className={`panel-sidebar-status ${degraded ? "degraded" : "healthy"}`} role="status" aria-label={`Coordinator connection: ${status}`} title={`${status} · ${version === "—" ? "Version unavailable" : `v${version}`}`}><i /><strong>{status}</strong></div>
      <div className="panel-sidebar-version" aria-label={`Coordinator version ${version}`}><span><strong>{version === "—" ? "—" : `v${version}`}</strong></span></div>
    </div>
  </div>;
}

import type { ReactNode, Ref } from "react";
import { Bot, PanelLeftClose, PanelLeftOpen, SunMoon, UserRound, X } from "lucide-react";
import { usePanelI18n, type PanelLocale } from "../i18n/panel-i18n";
import { Button, Link } from "./primitives";

export function Sidebar({ collapsed, open = false, inert = false, onToggle, onClose, closeButtonRef, homeHref, logoSrc, children }: {
  collapsed: boolean; open?: boolean; inert?: boolean; onToggle: () => void;
  onClose: () => void; closeButtonRef?: Ref<HTMLButtonElement>;
  homeHref: string; logoSrc: string; children: ReactNode;
}) {
  const { t } = usePanelI18n();
  return <aside id="panel-navigation" className={open ? "panel-sidebar open" : "panel-sidebar"} aria-label={t("shell.primaryNavigation")} inert={inert} data-ui="sidebar">
    <Button ref={closeButtonRef} type="button" className="panel-sidebar-close" aria-label={t("shell.closeNavigation")} onClick={onClose}><X size={18} /></Button>
    <Link className="panel-brand" href={homeHref} aria-label={t("shell.home")}><img src={logoSrc} alt="" /><div><strong>Mycellios</strong></div></Link>
    <Button type="button" className="panel-sidebar-toggle" aria-label={t(collapsed ? "shell.expandSidebar" : "shell.collapseSidebar")} title={t(collapsed ? "shell.expandSidebar" : "shell.collapseSidebar")} aria-expanded={!collapsed} aria-controls="panel-sidebar-links" onClick={onToggle}>
      {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
    </Button>
    {children}
  </aside>;
}

export function AgentNavigationLink() {
  return <Link variant="navigation" href="https://www.mycellios.com/agent" aria-label="Mycellios Agent" title="Mycellios Agent"><Bot size={18} /><span>Mycellios Agent</span></Link>;
}

export function SidebarFooter({ accountLabel, accountTitle, onAccount, theme, onTheme, locale, onLocale, status, degraded, version, earnMenu }: {
  accountLabel: string; accountTitle: string; onAccount: () => void;
  theme: "light" | "dark"; onTheme: () => void;
  /** Shown only when the surface offers a language choice. */
  locale?: PanelLocale; onLocale?: (locale: PanelLocale) => void; status: string;
  degraded: boolean; version: string; earnMenu: ReactNode;
}) {
  const { t } = usePanelI18n();
  const themeLabel = t(theme === "dark" ? "shell.switchToLight" : "shell.switchToDark");
  return <div className="panel-sidebar-footer compact-footer" data-ui="sidebar-footer">
    <div className="panel-top-actions panel-sidebar-actions">
      <Button className="panel-theme-indicator" type="button" onClick={onTheme} aria-label={themeLabel} title={themeLabel}><SunMoon size={16} /></Button>
      {locale && onLocale && <Button className="panel-theme-indicator panel-language-toggle" type="button" lang={locale === "es" ? "en" : "es"} onClick={() => onLocale(locale === "es" ? "en" : "es")} aria-label={t("shell.language.switchTo")} title={`${t("shell.language.current")} · ${t("shell.language.switchTo")}`}><span aria-hidden="true">{locale.toUpperCase()}</span></Button>}
      {earnMenu}
    </div>
    <Button type="button" className="panel-sidebar-account" onClick={onAccount} aria-label={accountTitle} title={accountTitle}><UserRound size={16} /><span><strong>{accountLabel}</strong></span></Button>
    <div className="panel-sidebar-meta">
      <div className={`panel-sidebar-status ${degraded ? "degraded" : "healthy"}`} role="status" aria-label={t("shell.status.label", { status })} title={`${status} · ${version === "—" ? t("shell.version.unavailable") : `v${version}`}`}><i /><strong>{status}</strong></div>
      <div className="panel-sidebar-version" aria-label={t("shell.version.label", { version })}><span><strong>{version === "—" ? "—" : `v${version}`}</strong></span></div>
    </div>
  </div>;
}

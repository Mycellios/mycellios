import { MARKETING_AGENT_URL, MARKETING_PRIMARY_LINKS, MARKETING_EXPLORE_LINKS, MARKETING_FOOTER_LINKS, MARKETING_SOCIAL_LINKS, MARKETING_BRAND_PATHS } from "../contracts/marketing-navigation.js";

const link = (href: string, label: string, active = false) => `<a class="ui-link" data-ui="link" data-size="md" href="${href}"${active ? ' aria-current="page"' : ""}>${label}</a>`;
const social = () => `<div class="marketing-social" role="group" aria-label="Social links">${MARKETING_SOCIAL_LINKS.map(item => `<a class="ui-link" data-ui="link" data-size="md" href="${item.href}" target="_blank" rel="noreferrer" aria-label="${item.label}"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="${MARKETING_BRAND_PATHS[item.icon]}" /></svg></a>`).join("")}</div>`;
const icon = (path: string, className = "", size = 21) => `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}" /></svg>`;

/** Same contract, UI-kit styles and disclosure behavior as the React marketing header. */
export function renderJournalNavigation(): string {
  const explore = `<details class="marketing-explore" data-ui="disclosure"><summary data-ui="disclosure-summary" aria-label="Open Explore menu">Explore${icon("m6 9 6 6 6-6", "", 13)}</summary><div class="marketing-popover">${MARKETING_EXPLORE_LINKS.map(item => `<span>${item.id === "staking" ? '<p class="ui-text" data-ui="text">$SPORE</p>' : ""}${link(item.href, item.label, item.id === "journal")}</span>`).join("")}</div></details>`;
  const items = MARKETING_PRIMARY_LINKS.map(item => link(item.href, item.label)).join("") + explore;
  return `<div class="marketing-navigation-surface"><header class="marketing-header"><a class="marketing-brand ui-link" data-ui="link" data-size="md" href="/" aria-label="Mycellios home"><img src="/assets/brand/favicon.png" width="30" height="30" alt="" /><span>Mycellios</span></a><nav class="marketing-desktop-nav" aria-label="Main navigation">${items}</nav><div class="marketing-header-actions"><a class="ui-button ui-link marketing-stats" data-ui="link" data-variant="navigation" data-size="sm" href="/dashboard">Stats</a>${social()}</div><details class="marketing-mobile-menu" data-ui="disclosure"><summary class="marketing-menu" data-ui="disclosure-summary" aria-label="Open navigation">${icon("M4 6h16M4 12h16M4 18h16", "marketing-open-icon")}${icon("m18 6-12 12M6 6l12 12", "marketing-close-icon")}</summary><nav class="marketing-mobile-nav" aria-label="Mobile navigation">${items}${social()}</nav></details></header></div>`;
}

export function renderJournalFooter(): string {
  return `<footer class="marketing-footer"><a class="marketing-brand ui-link" href="/"><img src="/assets/brand/favicon.png" width="27" height="27" alt="" />Mycellios</a><nav aria-label="Footer navigation">${MARKETING_FOOTER_LINKS.map(item => link(item.href, item.label + (item.href === MARKETING_AGENT_URL ? " ↗" : ""))).join("")}</nav>${social()}<small class="ui-text" data-ui="text">© ${new Date().getFullYear()} Mycellios</small></footer>`;
}

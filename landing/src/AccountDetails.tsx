import { Button as UiButton, Heading as UiHeading, Link as UiLink } from "./ui/primitives";
import { ArrowUpRight, CircleAlert, LogOut, UserRound } from "lucide-react";
import { AGENT_ACCOUNT_URL } from "../../src/contracts/agent-account-links";
import type { AuthSession, NetworkIdentity } from "./auth";
import { usePanelI18n } from "./i18n/panel-i18n";

export function MetaMaskProviderIcon() {
  return <svg viewBox="0 0 35 34" aria-hidden="true">
    <path d="M32.7077 32.7522L25.1688 30.5174L19.4833 33.9008L15.5167 33.8991L9.82793 30.5174L2.29225 32.7522L0 25.0489L2.29225 16.4993L0 9.27094L2.29225 0.312256L14.0674 7.31554H20.9326L32.7077 0.312256L35 9.27094L32.7077 16.4993L35 25.0489L32.7077 32.7522Z" fill="#FF5C16" />
    <path d="M2.29395 0.312256L14.0691 7.32047L13.6008 12.1301L2.29395 0.312256Z" fill="#FF5C16" />
    <path d="M9.82959 25.0522L15.0106 28.9811L9.82959 30.5175V25.0522Z" fill="#FF5C16" />
    <path d="M14.5966 18.5565L13.6009 12.1333L7.22692 16.5009L7.22363 16.4993V16.5025L7.24335 20.9983L9.82809 18.5565H9.82974H14.5966Z" fill="#FF5C16" />
    <path d="M32.7077 0.312256L20.9326 7.32047L21.3993 12.1301L32.7077 0.312256Z" fill="#FF5C16" />
    <path d="M25.1722 25.0522L19.9912 28.9811L25.1722 30.5175V25.0522Z" fill="#FF5C16" />
    <path d="M27.7766 16.5025H27.7783H27.7766V16.4993L27.775 16.5009L21.401 12.1333L20.4053 18.5565H25.1722L27.7586 20.9983L27.7766 16.5025Z" fill="#FF5C16" />
    <path d="M9.82793 30.5175L2.29225 32.7522L0 25.0522H9.82793V30.5175Z" fill="#E34807" />
    <path d="M14.5947 18.5549L16.0341 27.8406L14.0393 22.6777L7.23975 20.9984L9.82613 18.5549H14.593H14.5947Z" fill="#E34807" />
    <path d="M25.1721 30.5175L32.7078 32.7522L35.0001 25.0522H25.1721V30.5175Z" fill="#E34807" />
    <path d="M20.4053 18.5549L18.9658 27.8406L20.9607 22.6777L27.7602 20.9984L25.1722 18.5549H20.4053Z" fill="#E34807" />
    <path d="M0 25.0488L2.29225 16.4993H7.22183L7.23991 20.9967L14.0394 22.676L16.0343 27.8389L15.0089 28.976L9.82793 25.0472H0V25.0488Z" fill="#FF8D5D" />
    <path d="M35.0001 25.0488L32.7078 16.4993H27.7783L27.7602 20.9967L20.9607 22.676L18.9658 27.8389L19.9912 28.976L25.1722 25.0472H35.0001V25.0488Z" fill="#FF8D5D" />
    <path d="M20.9325 7.31543H17.4999H14.0673L13.6006 12.1251L16.0342 27.834H18.9656L21.4008 12.1251L20.9325 7.31543Z" fill="#FF8D5D" />
    <path d="M2.29225 0.312256L0 9.27094L2.29225 16.4993H7.22183L13.5991 12.1301L2.29225 0.312256Z" fill="#661800" />
    <path d="M13.17 20.4199H10.9369L9.72095 21.6062L14.0409 22.6727L13.17 20.4182V20.4199Z" fill="#661800" />
    <path d="M32.7077 0.312256L34.9999 9.27094L32.7077 16.4993H27.7781L21.4009 12.1301L32.7077 0.312256Z" fill="#661800" />
    <path d="M21.833 20.4199H24.0694L25.2853 21.6079L20.9604 22.676L21.833 20.4182V20.4199Z" fill="#661800" />
    <path d="M19.4817 30.8362L19.9911 28.9794L18.9658 27.8423H16.0327L15.0073 28.9794L15.5167 30.8362" fill="#661800" />
    <path d="M19.4816 30.8359V33.9021H15.5166V30.8359H19.4816Z" fill="#C0C4CD" />
    <path d="M9.82959 30.5142L15.52 33.9008V30.8346L15.0106 28.9778L9.82959 30.5142Z" fill="#E7EBF6" />
    <path d="M25.1721 30.5142L19.4817 33.9008V30.8346L19.9911 28.9778L25.1721 30.5142Z" fill="#E7EBF6" />
  </svg>;
}
/**
 * The dashboard only says who is signed in. Profile, the API subscription, API usage
 * and API keys live in the Mycellios Agent account.
 */
export function AccountDetails({ titleId, session, identity, roleBusy, error, onRetryRole, onSignOut }: {
  titleId: string;
  session: AuthSession;
  identity: NetworkIdentity | null;
  roleBusy: boolean;
  error: string | null;
  onRetryRole: () => void;
  onSignOut: () => void;
}) {
  const { t } = usePanelI18n();
  return <>
    <UiHeading as="h2" id={titleId}>{t("account.signedIn.title")}</UiHeading>
    <div className="account-identity-card"><UserRound /><span><small>{t("account.signedIn.as")}</small><strong>{identity?.email ?? session.user.email ?? identity?.id ?? session.user.id}</strong></span></div>
    {!identity && <div className="account-role-warning" role="status"><CircleAlert size={17} /><span>{t("account.role.warning")}</span><UiButton type="button" disabled={roleBusy} onClick={onRetryRole}>{t(roleBusy ? "account.role.checking" : "account.role.retry")}</UiButton></div>}
    <UiLink className="account-agent-link" href={AGENT_ACCOUNT_URL}>
      <span><strong>{t("account.agent.title")}</strong><small>{t("account.agent.detail")}</small></span>
      <ArrowUpRight size={16} aria-hidden="true" />
    </UiLink>
    {error && <div className="account-auth-error" role="alert"><CircleAlert size={16} />{error}</div>}
    <UiButton className="account-signout" onClick={onSignOut}><LogOut size={16} />{t("account.signOut")}</UiButton>
  </>;
}

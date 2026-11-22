import { ArrowRight, CheckCircle2, CircleAlert, Eye, EyeOff, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { SPORE_WELCOME_REWARD } from "../../src/contracts/spore-rewards";
import { AccountDetails, MetaMaskProviderIcon } from "./AccountDetails";
import { loadApiUsage, type ApiAccount, type ApiUsage } from "./api-access";
import {
  EmailConfirmationRequired,
  linkOAuthIdentity,
  loadAuthConfig,
  loadNetworkIdentity,
  signIn,
  signInWithGoogle,
  signInWithMetaMask,
  signInWithX,
  signUp,
  type AuthSession,
  type NetworkIdentity,
  type OAuthProvider,
  type PublicAuthConfig,
} from "./auth";
import { errorText } from "./panel-ui-utilities";
import { Button as UiButton, DialogPanel as UiDialogPanel, FieldLabel as UiFieldLabel, Form as UiForm, Heading as UiHeading, Input as UiInput, Text as UiText } from "./ui/primitives";

const brandIcon = "/assets/brand/favicon.png";

function GoogleProviderIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285f4" d="M21.6 12.23c0-.72-.06-1.42-.19-2.09H12v3.97h5.38a4.6 4.6 0 0 1-1.99 3.02v2.58h3.23c1.89-1.74 2.98-4.31 2.98-7.48Z" />
    <path fill="#34a853" d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.23-2.58c-.9.6-2.04.96-3.39.96-2.6 0-4.81-1.76-5.6-4.13H3.06v2.66A10 10 0 0 0 12 22Z" />
    <path fill="#fbbc05" d="M6.4 13.82A6 6 0 0 1 6.08 12c0-.63.11-1.25.32-1.82V7.52H3.06A10 10 0 0 0 2 12c0 1.61.39 3.14 1.06 4.48l3.34-2.66Z" />
    <path fill="#ea4335" d="M12 6.05c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.94 5.52l3.34 2.66c.79-2.37 3-4.13 5.6-4.13Z" />
  </svg>;
}

function XProviderIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.9 2H22l-6.77 7.74L23.2 22h-6.24l-4.89-6.39L6.49 22H3.37l7.24-8.28L2.96 2h6.4l4.42 5.84L18.9 2Zm-1.1 17.84h1.73L8.42 4.05H6.57L17.8 19.84Z" /></svg>;
}

type AccountTab = "account" | "billing" | "usage";

export function AccountModal({
  ready = true,
  config,
  onConfigLoaded,
  getValidSession,
  session,
  identity,
  account,
  onAuthenticated,
  onRetryRole,
  onSignOut,
  initialTab = "account",
  onClose,
}: {
  ready?: boolean;
  config: PublicAuthConfig;
  onConfigLoaded: (config: PublicAuthConfig) => void;
  getValidSession: (forceRefresh?: boolean) => Promise<AuthSession | null>;
  session: AuthSession | null;
  identity: NetworkIdentity | null;
  account: ApiAccount | null;
  onAuthenticated: (session: AuthSession, identity: NetworkIdentity | null) => void;
  onRetryRole: () => Promise<void>;
  onSignOut: () => void;
  initialTab?: AccountTab;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [providerBusy, setProviderBusy] = useState<"google" | "x" | "metamask" | null>(null);
  const [linkBusy, setLinkBusy] = useState<OAuthProvider | null>(null);
  const [roleBusy, setRoleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accountTab, setAccountTab] = useState<AccountTab>(initialTab);
  const [usage, setUsage] = useState<ApiUsage[]>([]);
  const [usageBusy, setUsageBusy] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const emailAvailable = config.providers?.email !== false;
  const googleAvailable = config.providers?.google === true;
  const xAvailable = config.providers?.twitter === true;
  const walletAvailable = Boolean(config.enabled && config.url && config.anonKey && config.providers?.web3 === true);
  const otherSignInAvailable = googleAvailable || xAvailable || walletAvailable;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const activeDialog: HTMLElement = dialog;
    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)];
    (focusable[0] ?? dialog).focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [...activeDialog.querySelectorAll<HTMLElement>(focusableSelector)];
      if (controls.length === 0) {
        event.preventDefault();
        activeDialog.focus();
        return;
      }
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      dialog.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || accountTab !== "usage") return;
    let cancelled = false;
    setUsageBusy(true);
    setError(null);
    void (async () => {
      const current = await getValidSession();
      if (!current || current.user.id !== userId) throw new Error("Your account session expired. Sign in again.");
      const nextUsage = await loadApiUsage(current.accessToken, 50, config.publicApiBaseUrl);
      if (!cancelled) setUsage(nextUsage);
    })().catch((caught) => { if (!cancelled) setError(errorText(caught)); })
      .finally(() => { if (!cancelled) setUsageBusy(false); });
    return () => { cancelled = true; };
  }, [accountTab, config.publicApiBaseUrl, getValidSession, session?.user.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      let activeConfig = config;
      if (!activeConfig.enabled || !activeConfig.url || !activeConfig.anonKey) {
        activeConfig = await loadAuthConfig(false);
        onConfigLoaded(activeConfig);
      }
      const nextSession = mode === "signin"
        ? await signIn(activeConfig, email.trim(), password)
        : await signUp(activeConfig, email.trim(), password);
      const nextIdentity = await loadNetworkIdentity(nextSession.accessToken).catch(() => null);
      onAuthenticated(nextSession, nextIdentity);
    } catch (caught) {
      if (caught instanceof EmailConfirmationRequired) {
        setMode("signin");
        setPassword("");
        setNotice(caught.message);
      } else {
        setError(errorText(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  function continueWithX() {
    setProviderBusy("x");
    setError(null);
    try {
      signInWithX(config);
    } catch (caught) {
      setProviderBusy(null);
      setError(errorText(caught));
    }
  }

  function continueWithGoogle() {
    setProviderBusy("google");
    setError(null);
    try {
      signInWithGoogle(config);
    } catch (caught) {
      setProviderBusy(null);
      setError(errorText(caught));
    }
  }

  async function linkProvider(provider: OAuthProvider) {
    if (!session) return;
    setLinkBusy(provider);
    setError(null);
    try {
      await linkOAuthIdentity(config, session, provider);
    } catch (caught) {
      setLinkBusy(null);
      setError(errorText(caught));
    }
  }

  async function retryRole() {
    setRoleBusy(true);
    setError(null);
    try {
      await onRetryRole();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setRoleBusy(false);
    }
  }

  async function continueWithMetaMask() {
    setProviderBusy("metamask");
    setError(null);
    try {
      const nextSession = await signInWithMetaMask(config);
      const nextIdentity = await loadNetworkIdentity(nextSession.accessToken).catch(() => null);
      onAuthenticated(nextSession, nextIdentity);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setProviderBusy(null);
    }
  }

  return <div className="modal-backdrop account-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <UiDialogPanel ref={dialogRef} className="account-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <UiButton type="button" className="account-modal-close" aria-label="Close" onClick={onClose}><X size={18} /></UiButton>
      <div className="account-modal-brand"><img src={brandIcon} alt="" /></div>
      {!ready && !session ? <>
        <UiHeading as="h2" id={titleId}>Checking your account</UiHeading>
        <UiText>Restoring your session and sign-in options…</UiText>
        <div className="account-usage-empty" role="status"><LoaderCircle className="spin" />Loading account…</div>
      </> : session ? <>
        <div className="account-detail-tabs">
          <UiButton className={accountTab === "account" ? "active" : ""} aria-pressed={accountTab === "account"} onClick={() => setAccountTab("account")}>Cuenta</UiButton>
          <UiButton className={accountTab === "billing" ? "active" : ""} aria-pressed={accountTab === "billing"} onClick={() => setAccountTab("billing")}>Plan</UiButton>
          <UiButton className={accountTab === "usage" ? "active" : ""} aria-pressed={accountTab === "usage"} onClick={() => setAccountTab("usage")}>Uso de la API</UiButton>
        </div>
        <AccountDetails tab={accountTab} titleId={titleId} session={session} identity={identity} account={account} usage={usage} usageBusy={usageBusy} linkBusy={linkBusy} roleBusy={roleBusy} providers={config.providers} error={error} onLinkProvider={(provider) => void linkProvider(provider)} onRetryRole={() => void retryRole()} onSignOut={onSignOut} />
      </> : <>
        <UiHeading as="h2" id={titleId}>{!emailAvailable ? "Continue to Mycellios" : mode === "signin" ? "Welcome back" : "Create your account"}</UiHeading>
        {(!emailAvailable || mode === "signup") && <UiText>Create your account and get {SPORE_WELCOME_REWARD} trial Spore in Mycellios Agent. Trial Spore has no monetary value.</UiText>}
        {!emailAvailable && <UiText>Email sign-in is unavailable on this network. Choose a provider below.</UiText>}
        {emailAvailable && <div className="account-mode-tabs"><UiButton className={mode === "signin" ? "active" : ""} onClick={() => { setMode("signin"); setNotice(null); setError(null); }}>Sign in</UiButton><UiButton className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setNotice(null); setError(null); }}>Create account</UiButton></div>}
        {emailAvailable && <UiForm onSubmit={(event) => void submit(event)}>
          <UiFieldLabel>Email<UiInput type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></UiFieldLabel>
          <UiFieldLabel>Password<span className="account-password-field"><UiInput type={passwordVisible ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /><UiButton type="button" aria-label={passwordVisible ? "Hide password" : "Show password"} aria-pressed={passwordVisible} title={passwordVisible ? "Hide password" : "Show password"} onClick={() => setPasswordVisible((visible) => !visible)}>{passwordVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</UiButton></span></UiFieldLabel>
          {notice && <div className="account-auth-success" role="status"><CheckCircle2 size={16} />{notice}</div>}
          {error && <div className="account-auth-error" role="alert"><CircleAlert size={16} />{error}</div>}
          <UiButton className="account-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : null}<span>{busy ? "Connecting…" : mode === "signin" ? "Sign in securely" : "Create account"}</span>{!busy && <ArrowRight aria-hidden="true" />}</UiButton>
        </UiForm>}
        {!emailAvailable && error && <div className="account-auth-error" role="alert"><CircleAlert size={16} />{error}</div>}
        {otherSignInAvailable && <><div className="account-provider-divider"><i />{emailAvailable ? "or continue with" : "Continue with"}<i /></div>
        <div className="account-provider-orbs" aria-label="Other sign-in options">
          {googleAvailable && <UiButton type="button" className="account-provider-google" aria-label="Continue with Google" title="Continue with Google" disabled={providerBusy !== null || busy} onClick={continueWithGoogle}>
            {providerBusy === "google" ? <LoaderCircle className="spin" /> : <GoogleProviderIcon />}
          </UiButton>}
          {xAvailable && <UiButton type="button" className="account-provider-x" aria-label="Continue with X" title="Continue with X" disabled={providerBusy !== null || busy} onClick={continueWithX}>
            {providerBusy === "x" ? <LoaderCircle className="spin" /> : <XProviderIcon />}
          </UiButton>}
          {walletAvailable && <UiButton type="button" className="account-provider-wallet" aria-label="Continue with MetaMask" title="Continue with MetaMask" disabled={providerBusy !== null || busy} onClick={() => void continueWithMetaMask()}>
            {providerBusy === "metamask" ? <LoaderCircle className="spin" /> : <MetaMaskProviderIcon />}
          </UiButton>}
        </div></>}
      </>}
    </UiDialogPanel>
  </div>;
}

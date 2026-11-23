import { useEffect, useState } from "react";
import mico from "../../public/mycellios/mico.png";
import wordmark from "../../public/mycellios/mark.png";
import { BrandLaunch } from "../components/BrandLaunch";
import { resolveUiLocale } from "../lib/ui-locale";
import { launchText } from "./launch-copy";
import type { AuthSession, PasswordRecovery, PublicAuthConfig } from "./auth";
import {
  AuthServiceError,
  clearAuthSession,
  completePasswordReset,
  consumeRecoveryRedirect,
  EmailConfirmationRequired,
  isDefinitiveAuthFailure,
  loadAuthConfig,
  requestPasswordReset,
  restoreAuthSession,
  signIn,
  signInWithOAuth,
  signUp,
  validAuthSession,
} from "./auth";
import type { FirstPartyClient } from "./first-party";
import {
  isFirstPartyAuthorization,
  isFirstPartyReturn,
  loadFirstPartyClients,
} from "./first-party";
import type { OAuthAuthorization } from "./oauth-consent";
import {
  authorizationId,
  decideOAuthAuthorization,
  getOAuthAuthorization,
  OAuthConsentError,
} from "./oauth-consent";

const sessionRejected = (error: unknown) => error instanceof OAuthConsentError && error.sessionRejected;

export function OAuthConsent() {
  const [config, setConfig] = useState<PublicAuthConfig | null>(null);
  const [clients, setClients] = useState<FirstPartyClient[] | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [details, setDetails] = useState<OAuthAuthorization | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [resume, setResume] = useState(0);
  const [mode, setMode] = useState<"sign-in" | "sign-up" | "reset-request" | "reset">("sign-in");
  const [recovery, setRecovery] = useState<PasswordRecovery | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [locale] = useState(() => resolveUiLocale());
  const text = (english: string, spanish: string) => (locale === "es" ? spanish : english);
  useEffect(() => {
    let active = true;
    void (async () => {
      const [c, allowed] = await Promise.all([loadAuthConfig(), loadFirstPartyClients()]);
      if (!c.enabled) throw new Error();
      // A reset link must be read before the ordinary session restore, which drops unknown fragments.
      const recovered = await consumeRecoveryRedirect(c);
      const s = recovered && recovered !== "expired" ? null : await restoreAuthSession(c);
      if (active) {
        setConfig(c);
        setClients(allowed);
        if (recovered === "expired") {
          setMode("reset-request");
          setError(
            text(
              "This reset link has expired or was already used. Request a new one.",
              "Este enlace ha caducado o ya se ha usado. Pide uno nuevo.",
            ),
          );
        } else if (recovered) {
          setRecovery(recovered);
          setMode("reset");
        }
        setSession(s);
      }
    })().catch(() => {
      if (active)
        setError(
          text(
            "Could not load sign-in. Please try again.",
            "No se ha podido cargar el acceso. Inténtalo de nuevo.",
          ),
        );
    });
    return () => {
      active = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (!config || !session || !clients) return;
    let active = true;
    void (async () => {
      const authority = { ...config, url: location.origin };
      const id = authorizationId(location.search);
      let s = await validAuthSession(config, session);
      let d: Awaited<ReturnType<typeof getOAuthAuthorization>> | null;
      try {
        d = await getOAuthAuthorization(authority, s, id);
      } catch (error) {
        if (!sessionRejected(error)) throw error;
        // A locally unexpired session can still be revoked by the authority
        // (for example after signing out elsewhere). Renew it once; if that is
        // refused too, forget it and show sign-in instead of looping here.
        d = null;
        try {
          s = await validAuthSession(config, s, true);
          d = await getOAuthAuthorization(authority, s, id);
        } catch (retry) {
          // Network errors keep the session and the retry screen.
          if (!sessionRejected(retry) && !isDefinitiveAuthFailure(retry)) throw retry;
        }
      }
      if (!active) return;
      if (!d) {
        clearAuthSession();
        setSession(null);
        setError(
          text(
            "Your session has ended. Sign in to continue.",
            "Tu sesión ha terminado. Inicia sesión para continuar.",
          ),
        );
        return;
      }
      if ("redirectUrl" in d) {
        if (!isFirstPartyReturn(d.redirectUrl, clients)) throw new Error();
        location.replace(d.redirectUrl);
      } else if (isFirstPartyAuthorization(d, clients)) {
        const next = await decideOAuthAuthorization(authority, s, d, "approve");
        if (!isFirstPartyReturn(next, clients)) throw new Error();
        if (active) location.replace(next);
      } else setDetails(d);
    })().catch(() => {
      if (active)
        setError(
          text(
            "This sign-in request has expired. Open Mycellios again.",
            "Este acceso ha caducado. Vuelve a entrar en Mycellios.",
          ),
        );
    });
    return () => {
      active = false;
    };
  }, [config, session, clients, resume]);

  async function decide(action: "approve" | "deny") {
    if (!config || !session || !details) return;
    setBusy(true);
    setError("");
    try {
      const s = await validAuthSession(config, session);
      location.assign(
        await decideOAuthAuthorization({ ...config, url: location.origin }, s, details, action),
      );
    } catch {
      setError(
        text(
          "Could not complete sign-in. Please try again.",
          "No se ha podido completar el acceso. Inténtalo de nuevo.",
        ),
      );
      setBusy(false);
    }
  }

  const signingIn = Boolean(config && session && !details && !error);
  const loading = !config && !error;
  const blocked = Boolean(error && (!config || (session && !details)));
  if (signingIn || loading || blocked) {
    return (
      <BrandLaunch
        documentFrame
        wordAsLink
        busy
        pending={signingIn || loading}
        attempt={attempt + resume}
        locale={locale}
        markSrc={mico}
        wordSrc={wordmark}
        status={error ? undefined : signingIn ? launchText(locale, "signingIn") : launchText(locale, "loading")}
        alert={error || undefined}
        slowHint={launchText(locale, "slow")}
        retryLabel={
          error && session ? text("Sign in again", "Volver a entrar") : launchText(locale, "retry")
        }
        retryHref={error && session ? "/agent/sign-in" : undefined}
        onRetry={
          error && session
            ? undefined
            : () => {
                setError("");
                if (session) setResume((value) => value + 1);
                else setAttempt((value) => value + 1);
              }
        }
      />
    );
  }

  if (!config) return null;

  return (
    <main className="oauth-consent" lang={locale === "es" ? "es" : "en"}>
      <section>
        <header className="login-header">
        <a className="login-brand" href="/" aria-label="Mycellios">
          <span className="login-mark-tile" aria-hidden="true">
            {/* The same mushroom geometry as public/mycellios/loader.svg, at rest. */}
            <svg className="login-mark" width="44" height="44" viewBox="0 0 64 64" fill="none" focusable="false">
              <path fill="#3f9f78" d="M26 30h12l3 21c.5 3.5-2 6-5.5 6h-7c-3.5 0-6-2.5-5.5-6l3-21Z" />
              <path fill="#3f9f78" d="M6 28C7 16 18 7 32 7s25 9 26 21c.3 4-2.5 7-6.5 7h-39C8.5 35 5.7 32 6 28Z" />
              <g fill="#1d2b23">
                <rect x="26" y="40" width="3.5" height="8" rx="1.75" />
                <rect x="34.5" y="40" width="3.5" height="8" rx="1.75" />
              </g>
            </svg>
          </span>
          <span>Mycellios</span>
        </a>
        <h1>
          {details
            ? text("Authorize access", "Autorizar acceso")
            : mode === "sign-up"
              ? text("Create your account", "Crear tu cuenta")
              : mode === "reset-request"
                ? text("Reset your password", "Restablecer la contraseña")
                : mode === "reset"
                  ? text("Choose a new password", "Elige una contraseña nueva")
                  : text("Sign in", "Iniciar sesión")}
        </h1>
        </header>
        {error ? <p role="alert">{error}</p> : null}
        {error && session ? (
          <a className="login-button" href="/agent/sign-in">
            {text("Sign in again", "Volver a entrar")}
          </a>
        ) : null}
        {!session && (mode === "reset-request" || mode === "reset") ? (
          <>
            {resetSent ? (
              <p role="status">
                {text(
                  "If an account uses that email, we sent it a link to reset the password.",
                  "Si hay una cuenta con ese correo, le hemos enviado un enlace para restablecer la contraseña.",
                )}
              </p>
            ) : (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (busy) return;
                  setBusy(true);
                  setError("");
                  const data = new FormData(event.currentTarget);
                  try {
                    if (mode === "reset-request") {
                      await requestPasswordReset(config, String(data.get("email")));
                      setResetSent(true);
                    } else if (recovery) {
                      const next = await completePasswordReset(config, recovery, String(data.get("password")));
                      setRecovery(null);
                      setMode("sign-in");
                      setSession(next);
                    }
                  } catch (error) {
                    setError(
                      error instanceof AuthServiceError && error.code === "weak_password"
                        ? text(
                            "Choose a longer password that is harder to guess.",
                            "Elige una contraseña más larga y difícil de adivinar.",
                          )
                        : error instanceof AuthServiceError && error.code === "same_password"
                          ? text(
                              "Choose a password you have not used for this account.",
                              "Elige una contraseña que no hayas usado en esta cuenta.",
                            )
                          : error instanceof AuthServiceError && error.status === 429
                            ? text(
                                "Too many attempts. Wait a minute and try again.",
                                "Demasiados intentos. Espera un minuto y vuelve a intentarlo.",
                              )
                            : text(
                                "Could not reset the password. Please try again.",
                                "No se ha podido restablecer la contraseña. Inténtalo de nuevo.",
                              ),
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {mode === "reset-request" ? (
                  <label>
                    <span className="login-label">{text("Email address", "Correo electrónico")}</span>
                    <input
                      name="email"
                      type="email"
                      autoComplete="username"
                      placeholder={text("you@example.com", "tu@correo.com")}
                      required
                      disabled={busy}
                    />
                  </label>
                ) : (
                  <label>
                    <span className="login-label">{text("New password", "Contraseña nueva")}</span>
                    <input
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      placeholder={text("New password", "Contraseña nueva")}
                      required
                      disabled={busy}
                    />
                  </label>
                )}
                <button type="submit" disabled={busy}>
                  {busy
                    ? text("Please wait…", "Un momento…")
                    : mode === "reset-request"
                      ? text("Send reset link", "Enviar enlace")
                      : text("Save password", "Guardar contraseña")}
                </button>
              </form>
            )}
            {mode === "reset-request" ? (
              <p className="login-switcher">
                <button
                  type="button"
                  className="login-switch"
                  disabled={busy}
                  onClick={() => {
                    setMode("sign-in");
                    setError("");
                    setResetSent(false);
                  }}
                >
                  {text("Back to sign in", "Volver a iniciar sesión")}
                </button>
              </p>
            ) : null}
          </>
        ) : !session ? (
          <>
            {confirmationRequired ? (
              <p role="status">
                {text(
                  "Check your email to confirm your account, then sign in here to continue.",
                  "Confirma tu cuenta desde el correo y después inicia sesión aquí para continuar.",
                )}
              </p>
            ) : null}
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (busy) return;
                setBusy(true);
                setError("");
                setConfirmationRequired(false);
                const data = new FormData(event.currentTarget);
                try {
                  setSession(
                    await (mode === "sign-up" ? signUp : signIn)(
                      config,
                      String(data.get("email")),
                      String(data.get("password")),
                    ),
                  );
                } catch (error) {
                  if (mode === "sign-up" && error instanceof EmailConfirmationRequired) {
                    setConfirmationRequired(true);
                    setMode("sign-in");
                  } else if (
                    mode === "sign-up" &&
                    error instanceof AuthServiceError &&
                    error.code === "user_already_exists"
                  ) {
                    setError(
                      text(
                        "This email already has a Mycellios account. Choose Sign in below to continue.",
                        "Este correo ya tiene una cuenta de Mycellios. Pulsa Iniciar sesión debajo para continuar.",
                      ),
                    );
                  } else if (
                    mode === "sign-up" &&
                    error instanceof AuthServiceError &&
                    error.code === "weak_password"
                  ) {
                    setError(
                      text(
                        "Choose a longer password that is harder to guess.",
                        "Elige una contraseña más larga y difícil de adivinar.",
                      ),
                    );
                  } else
                    setError(
                      mode === "sign-up"
                        ? text(
                            "Could not create your account. Check your email and password, or sign in if you already have an account.",
                            "No se ha podido crear la cuenta. Revisa el correo y la contraseña, o inicia sesión si ya tienes cuenta.",
                          )
                        : text(
                            "Check your email and password and try again.",
                            "Revisa el correo y la contraseña e inténtalo de nuevo.",
                          ),
                    );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                <span className="login-label">{text("Email address", "Correo electrónico")}</span>
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder={text("you@example.com", "tu@correo.com")}
                  required
                  disabled={busy}
                />
              </label>
              <label>
                <span className="login-label">{text("Password", "Contraseña")}</span>
                <input
                  key={mode}
                  name="password"
                  type="password"
                  autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                  placeholder={text("Password", "Contraseña")}
                  required
                  disabled={busy}
                />
              </label>
              <button type="submit" disabled={busy}>
                {busy
                  ? text("Please wait…", "Un momento…")
                  : mode === "sign-up"
                    ? text("Create account", "Crear cuenta")
                    : text("Sign in", "Entrar")}
              </button>
            </form>
            <p className="login-switcher">
              {mode === "sign-up"
                ? text("Already have an account?", "¿Ya tienes cuenta?")
                : text("New to Mycellios?", "¿Aún no tienes cuenta?")}
              <button
                type="button"
                className="login-switch"
                disabled={busy}
                onClick={() => {
                  setMode(mode === "sign-up" ? "sign-in" : "sign-up");
                  setError("");
                  setConfirmationRequired(false);
                }}
              >
                {mode === "sign-up"
                  ? text("Sign in", "Iniciar sesión")
                  : text("Create account", "Crear cuenta")}
              </button>
            </p>
            {mode === "sign-in" ? (
              <p className="login-switcher">
                <button
                  type="button"
                  className="login-switch"
                  disabled={busy}
                  onClick={() => {
                    setMode("reset-request");
                    setError("");
                    setConfirmationRequired(false);
                  }}
                >
                  {text("Forgot your password?", "¿Has olvidado la contraseña?")}
                </button>
              </p>
            ) : null}
            {(["google", "twitter"] as const)
              .filter((p) => config.providers?.[p])
              .map((p) => (
                <button
                  type="button"
                  className="login-secondary"
                  key={p}
                  disabled={busy}
                  onClick={() => signInWithOAuth(config, p)}
                >
                  {text("Continue with", "Continuar con")} {p === "google" ? "Google" : "X"}
                </button>
              ))}
          </>
        ) : details && !error ? (
          <>
            <p>
              <strong>{details.client.name}</strong>{" "}
              {text("requests access to your account.", "solicita acceso a tu cuenta.")}
            </p>
            <p>
              {text("Permissions:", "Permisos:")} {details.scope}
            </p>
            <button type="button" disabled={busy} onClick={() => void decide("approve")}>
              {text("Continue", "Continuar")}
            </button>
            <button
              type="button"
              className="login-secondary"
              disabled={busy}
              onClick={() => void decide("deny")}
            >
              {text("Cancel", "Cancelar")}
            </button>
          </>
        ) : null}
      </section>
    </main>
  );
}

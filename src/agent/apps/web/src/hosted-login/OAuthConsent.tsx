import { useEffect, useState } from "react";
import loginMark from "../../public/mycellios/app-icon-v2-192.png";
import mico from "../../public/mycellios/mico.png";
import wordmark from "../../public/mycellios/mark.png";
import { BrandLaunch } from "../components/BrandLaunch";
import { resolveUiLocale } from "../lib/ui-locale";
import { launchText } from "./launch-copy";
import type { AuthSession, PublicAuthConfig } from "./auth";
import {
  AuthServiceError,
  EmailConfirmationRequired,
  loadAuthConfig,
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
import { authorizationId, decideOAuthAuthorization, getOAuthAuthorization } from "./oauth-consent";

export function OAuthConsent() {
  const [config, setConfig] = useState<PublicAuthConfig | null>(null);
  const [clients, setClients] = useState<FirstPartyClient[] | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [details, setDetails] = useState<OAuthAuthorization | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [resume, setResume] = useState(0);
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [locale] = useState(() => resolveUiLocale());
  const text = (english: string, spanish: string) => (locale === "es" ? spanish : english);
  useEffect(() => {
    let active = true;
    void (async () => {
      const [c, allowed] = await Promise.all([loadAuthConfig(), loadFirstPartyClients()]);
      if (!c.enabled) throw new Error();
      const s = await restoreAuthSession(c);
      if (active) {
        setConfig(c);
        setClients(allowed);
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
      const s = await validAuthSession(config, session);
      const authority = { ...config, url: location.origin };
      const d = await getOAuthAuthorization(authority, s, authorizationId(location.search));
      if (!active) return;
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
          <img className="login-mark" src={loginMark} width={38} height={38} alt="" />
          <span>Mycellios</span>
        </a>
        <h1>
          {details
            ? text("Authorize access", "Autorizar acceso")
            : mode === "sign-up"
              ? text("Create your account", "Crear tu cuenta")
              : text("Sign in", "Iniciar sesión")}
        </h1>
        </header>
        {error ? <p role="alert">{error}</p> : null}
        {error && session ? (
          <a className="login-button" href="/agent/sign-in">
            {text("Sign in again", "Volver a entrar")}
          </a>
        ) : null}
        {!session ? (
          <>
            {mode === "sign-up" ? (
              <p className="login-description">
                {text(
                  "One account for Mycellios and your agent.",
                  "Una sola cuenta para Mycellios y tu agente.",
                )}
              </p>
            ) : null}
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
                {text("Email address", "Correo electrónico")}
                <input name="email" type="email" autoComplete="username" required disabled={busy} />
              </label>
              <label>
                {text("Password", "Contraseña")}
                <input
                  key={mode}
                  name="password"
                  type="password"
                  autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
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

import { useEffect, useState, type ReactNode } from "react";
import { appPath } from "../lib/app-path";
import { desktopDragClass } from "../lib/desktop";
import "./brand-launch.css";

export const SIGN_IN_WAIT_MS = 8000;

type BrandLaunchProps = {
  markSrc: string;
  wordSrc: string;
  animatedSrc?: string;
  alt?: string;
  busy?: boolean;
  drag?: boolean;
  wordAsLink?: boolean;
  documentFrame?: boolean;
  surface?: string;
  appState?: "session-pending" | "i18n-pending";
  toolbar?: ReactNode;
  locale?: string;
  status?: string;
  alert?: string;
  slowHint?: string;
  retryLabel?: string;
  pending?: boolean;
  attempt?: number;
  onRetry?: () => void;
  retryHref?: string;
  children?: ReactNode;
};

export function BrandLaunch({
  markSrc,
  wordSrc,
  animatedSrc,
  alt = "",
  busy = false,
  drag = false,
  wordAsLink = false,
  documentFrame = false,
  surface,
  appState,
  toolbar,
  locale,
  status,
  alert,
  slowHint,
  retryLabel,
  pending = false,
  attempt = 0,
  onRetry,
  retryHref,
  children,
}: BrandLaunchProps) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!pending) return;
    const timer = window.setTimeout(() => setSlow(true), SIGN_IN_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [pending, attempt]);
  const showRetry = Boolean(alert || (slow && (onRetry || retryHref)));
  const word = (
    <>
      <img src={wordSrc} alt="" width={26} height={26} />
      <span className="brand-launch-title">
        <span className="brand-launch-name">Mycellios</span>
        <span className="brand-launch-agent">Agent</span>
      </span>
    </>
  );
  return (
    <div
      className={documentFrame ? "brand-launch brand-launch-document" : "brand-launch"}
      lang={locale}
      dir={locale === "he" ? "rtl" : undefined}
      data-rakazo-surface={surface}
      data-rakazo-app-state={appState}
      role={appState ? "status" : undefined}
      aria-label={appState ? "Mycellios" : undefined}
    >
      <header className={["brand-launch-bar", drag ? desktopDragClass() : ""].filter(Boolean).join(" ")}>
        {wordAsLink ? (
          <a className="brand-launch-wordmark" href="/" aria-label="Mycellios">
            {word}
          </a>
        ) : (
          <span className="brand-launch-wordmark" role="img" aria-label="Mycellios Agent">
            {word}
          </span>
        )}
        {toolbar}
      </header>
      <main className="brand-launch-stage">
        <div className="brand-launch-hero">
          <BrandMark src={markSrc} animatedSrc={animatedSrc} alt={alt} busy={busy} />
        </div>
        <div className="brand-launch-copy">
          {status ? (
            <p className="brand-launch-status" role="status">
              {status}
            </p>
          ) : null}
          {alert ? (
            <p className="brand-launch-alert" role="alert">
              {alert}
            </p>
          ) : null}
          {children}
          {slow && slowHint ? <p className="brand-launch-hint">{slowHint}</p> : null}
          {showRetry && retryHref ? (
            <a className="brand-launch-retry" href={retryHref}>
              {retryLabel}
            </a>
          ) : null}
          {showRetry && !retryHref && onRetry ? (
            <button type="button" className="brand-launch-retry" onClick={onRetry}>
              {retryLabel}
            </button>
          ) : null}
        </div>
      </main>
    </div>
  );
}

export function BrandMark({
  src,
  animatedSrc,
  alt = "",
  busy = false,
}: {
  src: string;
  animatedSrc?: string;
  alt?: string;
  busy?: boolean;
}) {
  if (busy) {
    return (
      <div className="brand-launch-mark brand-launch-loader">
        <img
          src={appPath("/mycellios/loader.svg")}
          alt=""
          width={192}
          height={192}
          draggable={false}
        />
      </div>
    );
  }
  return (
    <div className="brand-launch-mark">
      <picture>
        {animatedSrc ? (
          <source
            srcSet={animatedSrc}
            type="image/webp"
            media="(prefers-reduced-motion: no-preference)"
          />
        ) : null}
        <img src={src} alt={alt} width={192} height={192} draggable={false} />
      </picture>
    </div>
  );
}

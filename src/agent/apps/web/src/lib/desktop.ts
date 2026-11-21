import type {
  RakazoDesktop,
  RakazoDesktopOAuthCallback,
  RakazoDesktopWhatsApp,
  RakazoDesktopWhatsAppStatus,
} from "@rakazo/contracts";
import { DEFAULT_COMPUTER_MODE, type ComputerMode } from "@rakazo/contracts";

export type { RakazoDesktop, RakazoDesktopOAuthCallback } from "@rakazo/contracts";

declare global {
  interface Window {
    rakazoDesktop?: RakazoDesktop;
  }
}

export function desktopBridge(): RakazoDesktop | undefined {
  return typeof window === "undefined" ? undefined : window.rakazoDesktop;
}

/**
 * Ordinary new Micos use their own isolated server workspace. An explicitly
 * chosen installed account keeps the existing native first-run computer route;
 * isolation must never silently authorize or redirect a local project.
 */
export function defaultComputerMode(desktop?: RakazoDesktop, installedAccountSelected = false): ComputerMode {
  return installedAccountSelected ? (desktop ? "dedicated" : "team") : DEFAULT_COMPUTER_MODE;
}

/**
 * Bind this Mico to the Desktop that is actually running it. "This PC" must
 * never be saved without a live host binding, because the server would have to
 * fall back to a cloud container while the label still says This PC.
 */
export async function connectThisComputer(botId: string): Promise<void> {
  const computer = desktopBridge()?.computer;
  if (!computer?.connect) {
    throw new Error("Open Mycellios Desktop on this computer to use it.");
  }
  if (!(await computer.requestAccess())) {
    throw new Error("Local computer access was not allowed.");
  }
  await computer.connect(botId);
  if (computer.connected && !(await computer.connected(botId))) {
    throw new Error("The local computer is disconnected.");
  }
}

/** The compact `code#state` form the manual paste flow already accepts. */
export function desktopOAuthCode(callback: RakazoDesktopOAuthCallback) {
  return callback.state === undefined ? callback.code : `${callback.code}#${callback.state}`;
}

/**
 * The authorize URL carries the attempt's PKCE state, so a captured code whose
 * state differs belongs to a different attempt — a popup left open by a
 * cancelled sign-in, say — and must not be spent on the current one.
 */
export function oauthStateOf(verificationUri: string): string | undefined {
  try {
    return new URL(verificationUri).searchParams.get("state") ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Desktop sign-in redirects to a loopback URL the renderer never sees.
 * The main process captures the code there so the browser flow's
 * copy-and-paste step can be skipped. No-ops in a browser.
 *
 * Pass the attempt's state to ignore codes captured for any other attempt.
 * Providers whose authorize URL carries no state cannot be correlated, so
 * their codes are accepted as before.
 */
export function onDesktopOAuthCallback(
  listener: (code: string) => void,
  expectedState?: string,
): () => void {
  const oauth = desktopBridge()?.oauth;
  if (!oauth) return () => undefined;
  return oauth.onCallback((callback) => {
    if (expectedState !== undefined && callback.state !== expectedState) return;
    listener(desktopOAuthCode(callback));
  });
}

export function windowChromeKind(desktop?: RakazoDesktop): "spacer" | "darwin" | "native" | "controls" {
  if (!desktop) return "spacer";
  if (desktop.platform === "darwin") return "darwin";
  if (desktop.nativeWindowFrame) return "native";
  return "controls";
}

/** macOS hides the title bar into the page. Windows and Linux use the OS frame. */
export function desktopHidesTitleBar(desktop: RakazoDesktop | undefined = desktopBridge()): boolean {
  return desktop?.platform === "darwin";
}

export function desktopDragClass(desktop?: RakazoDesktop): string {
  return desktopHidesTitleBar(desktop) ? "app-drag" : "";
}

/** WhatsApp linked-device sessions held by this PC. Absent in browsers and older Desktop releases. */
export type DesktopWhatsAppBridge = RakazoDesktopWhatsApp;
export type DesktopWhatsAppStatus = RakazoDesktopWhatsAppStatus;

export function whatsappBridge(): DesktopWhatsAppBridge | undefined {
  return desktopBridge()?.whatsapp;
}

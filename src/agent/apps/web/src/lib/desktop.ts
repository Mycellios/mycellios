import type {
  MycelliosDesktop,
  MycelliosDesktopOAuthCallback,
  MycelliosDesktopWhatsApp,
  MycelliosDesktopWhatsAppStatus,
} from "@mycellios/contracts";
import { DEFAULT_COMPUTER_MODE, type ComputerMode } from "@mycellios/contracts";

export type { MycelliosDesktop, MycelliosDesktopOAuthCallback } from "@mycellios/contracts";

declare global {
  interface Window {
    mycelliosDesktop?: MycelliosDesktop;
    rakazoDesktop?: MycelliosDesktop;
  }
}

export function desktopBridge(
  host: Pick<Window, "mycelliosDesktop" | "rakazoDesktop"> | undefined =
    typeof window === "undefined" ? undefined : window,
): MycelliosDesktop | undefined {
  return host?.mycelliosDesktop ?? host?.rakazoDesktop;
}

/**
 * A Mico created in Desktop works on this PC, in its own folder, as the reference app's
 * agents do (behavior reference only). Binding still waits for the owner's
 * local-access consent on the first send. Without a Desktop host, new Micos use
 * their own isolated server workspace; an explicitly chosen installed account
 * keeps the shared computer route.
 */
export function defaultComputerMode(desktop?: MycelliosDesktop, installedAccountSelected = false): ComputerMode {
  if (desktop?.computer?.connect || (desktop && installedAccountSelected)) return "dedicated";
  return installedAccountSelected ? "team" : DEFAULT_COMPUTER_MODE;
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
export function desktopOAuthCode(callback: MycelliosDesktopOAuthCallback) {
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

export function windowChromeKind(desktop?: MycelliosDesktop): "spacer" | "darwin" | "native" | "controls" {
  if (!desktop) return "spacer";
  if (desktop.platform === "darwin") return "darwin";
  if (desktop.nativeWindowFrame) return "native";
  return "controls";
}

/** macOS hides the title bar into the page. Windows and Linux use the OS frame. */
export function desktopHidesTitleBar(desktop: MycelliosDesktop | undefined = desktopBridge()): boolean {
  return desktop?.platform === "darwin";
}

export function desktopDragClass(desktop?: MycelliosDesktop): string {
  return desktopHidesTitleBar(desktop) ? "app-drag" : "";
}

/** WhatsApp linked-device sessions held by this PC. Absent in browsers and older Desktop releases. */
export type DesktopWhatsAppBridge = MycelliosDesktopWhatsApp;
export type DesktopWhatsAppStatus = MycelliosDesktopWhatsAppStatus;

export function whatsappBridge(): DesktopWhatsAppBridge | undefined {
  return desktopBridge()?.whatsapp;
}

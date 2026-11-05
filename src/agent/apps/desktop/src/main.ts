import { installAccountComputerBackground } from "./account-computer-background.js";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { nativeEnvironment } from "@rakazo/adapters/native-agent-process";
import type { DesktopReachability, DesktopSetup } from "@rakazo/contracts";
import type { Session } from "electron";
import { app, BrowserWindow, dialog, ipcMain, Menu, net, session, shell, utilityProcess } from "electron";
import type { AppDocumentState } from "./app-document-state.js";
import { APP_DOCUMENT_STATE_SCRIPT } from "./app-document-state.js";
import { createAppOpener } from "./app-opener.js";
import {
  DesktopUpdateController,
  type ElectronAutoUpdater,
  LAUNCH_CHECK_DELAY_MS,
  updaterSupport,
} from "./auto-update.js";
import { createBadgeHandler } from "./badge.js";
import { openBrowserAuth } from "./browser-auth.js";
import { DOCKER_INSTALL_LINKS, isDesktopSetupLink, runDocker } from "./docker-cli.js";
import { computerConsentScope, prepareHostComputer } from "./host-computer.js";
import { ContributionRuntime, mayManageContribution } from "./contribution-runtime.js";
import { DesktopRelayClient } from "./desktop-relay.js";
import { desktopProjectPolicy } from "./project-preview-policy.js";
import { LocalNativeStackController } from "./local-native-stack.js";
import { saveLocalComputerHost } from "./local-settings.js";
import {
  LocalStackController,
  readStackToken,
  readStackWebUrl,
  resolveImageTag,
  stackDir,
  stackResourceDir,
} from "./local-stack.js";
import {
  configureDesktopMonitoring,
  disableDesktopMonitoring,
  installDesktopEarlyErrorReporting,
  refreshDesktopMonitoringUser,
  reportDesktopError,
} from "./monitoring.js";
import { oauthCallbackFrom } from "./oauth-callback.js";
import { associatedPasskeyRpIds } from "./passkeys.js";
import {
  bundledRendererCandidates,
  bundledRendererHeaders,
  forwardedRendererRequestInit,
  isRendererAssetMiss,
  resolvePackagedRenderer,
} from "./renderer-assets.js";
import { revealSecondInstanceWindow, secondInstanceWindow } from "./second-instance.js";
import { installSessionPermissions } from "./session-permissions.js";
import {
  DEFAULT_LOCAL_WEB_URL,
  desktopStackImageTag,
  desktopServerEndpoint,
  desktopEntryUrl,
  isRakazoHealth,
  managedLocalOpenUrl,
  maySendDesktopStackToken,
  normalizeServerUrl,
  parseSetupInput,
  probeFailureMessage,
  RAKAZO_CLOUD_URL,
  readProbeJson,
  resolveStartupTarget,
  safeExternalUrl,
  sessionPartitionForServerUrl,
} from "./setup-config.js";
import { clearSetup, readSetup, writeSetup } from "./setup-store.js";
import { oauthPopupSessionPreferences, shouldOpenInAppPopup } from "./window-open.js";
import { installWindowChrome } from "./window-chrome.js";
import { installProjectBrowser } from "./project-browser.js";
import { installProjectRunner } from "./project-runner-ipc.js";
import { nativePreviewContext, nativeProjectSpace } from "./project-session.js";
import { installProjectConversations } from "./project-conversations-ipc.js";
import { assertProjectGrant } from "./project-grant.js";
import {
  browserWindowOptions,
  developmentIconFile,
  setupWindowOptions,
  warmWindowTtlMs,
} from "./window-options.js";

process.setSourceMapsEnabled(true);
installDesktopEarlyErrorReporting();

const PERFORMANCE_USER_DATA = process.env.RAKAZO_PERFORMANCE_USER_DATA;
/** Test hook: where the app-managed stack answers. Mode `new` still requires loopback. */
const LOCAL_WEB_URL = process.env.RAKAZO_LOCAL_WEB_URL?.trim() || DEFAULT_LOCAL_WEB_URL;
const PROBE_TIMEOUT_MS = 8_000;
const APP_DOCUMENT_READY_TIMEOUT_MS = 20_000;
const DESKTOP_STACK_PROBE_PATH = "/.well-known/rakazo-desktop-stack";
const DESKTOP_STACK_TOKEN_HEADER = "x-rakazo-desktop-stack-token";
let mainWindow: BrowserWindow | null = null;
const appWindowTargets = new WeakMap<BrowserWindow, string>();
let setupWindow: BrowserWindow | null = null;
const bundledRendererInstallations = new Set<string>();
let currentSetup: DesktopSetup | null = null;
let currentTargetUrl: string | null = null;
let monitoringSession: Session | undefined;
let monitoringTargetUrl: string | undefined;
let stopMonitoringSession: (() => void) | undefined;
let setupError: string | null = null;
// Native-owned failed target. The recovery renderer cannot choose a retry URL.
let setupRetryTarget: string | null = null;
let setupSaveInProgress = false;
const appOpener = createAppOpener(openAppOnce);
/** Prior app window kept until setup is persisted (or the switch is abandoned). */
let pendingPreviousWindow: BrowserWindow | null = null;
let quitting = false;
let warmWindowTimer: NodeJS.Timeout | undefined;
// Number of short-lived hidden probe windows currently alive. On Windows/Linux,
// destroying the last window fires "window-all-closed" -> app.quit(); a probe
// that runs before the first real window exists must not count as "all closed".
let liveProbeWindows = 0;
const WARM_WINDOW_TTL_MS = warmWindowTtlMs(process.env.RAKAZO_WARM_WINDOW_TTL_MS);

const updaterEnvironment = {
  packaged: app.isPackaged,
  version: app.getVersion(),
  disabled: process.env.MYCELLIOS_AGENT_UPDATES_ENABLED !== "1" || process.env.RAKAZO_DISABLE_AUTO_UPDATE === "1",
};
const desktopUpdater = new DesktopUpdateController(
  updaterEnvironment,
  async () => {
    const module = await import("electron-updater");
    return (module.default ?? module).autoUpdater as unknown as ElectronAutoUpdater;
  },
  undefined,
  () => {
    quitting = false;
  },
);
let launchUpdateCheckScheduled = false;
let localStack: Pick<LocalStackController, "webUrl" | "state" | "matchesDesiredStack" | "start" | "stop" | "abort">;
let hostComputer: Awaited<ReturnType<typeof prepareHostComputer>> | undefined;
let cloudComputer: DesktopRelayClient | undefined;
let cloudComputerBase: string | undefined;
let cloudComputerOwner: string | undefined;
let accountComputer: ReturnType<typeof installAccountComputerBackground> | undefined;
let accountComputerSession: {base:string;session:Session}|undefined;
let projectRunner: ReturnType<typeof installProjectRunner> | undefined;
let contributionRuntime: ContributionRuntime;
let requestingComputerAccess = false;

markOnce("rk:main:module-evaluated");
if (PERFORMANCE_USER_DATA) {
  app.setPath("userData", PERFORMANCE_USER_DATA);
  app.setPath("sessionData", path.join(PERFORMANCE_USER_DATA, "session"));
} else {
  // Keep sessions, permissions and local projects across the customer-facing rename.
  app.setPath("userData", path.join(app.getPath("appData"), "Mycellios Agent"));
}
app.once("will-finish-launching", () => markOnce("rk:main:will-finish-launching"));
app.once("ready", () => markOnce("rk:main:ready"));
// Includes fresh partitions and popup-created sessions, before they load remote content.
app.on("session-created", (value) => installSessionPermissions(value, permissionTarget));

const passkeyRpIds = associatedPasskeyRpIds({
  platform: process.platform,
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  exists: existsSync,
});
// Routes WebAuthn to the system passkey sheet (iCloud Keychain and other providers).
if (passkeyRpIds.length > 0) app.configureWebAuthn({ platformPasskeys: true });

function permissionTarget() {
  if (mainWindow === null || mainWindow.isDestroyed()) return null;
  const url = appWindowTargets.get(mainWindow);
  return url === undefined ? null : { webContents: mainWindow.webContents, url };
}

function markOnce(name: string) {
  if (performance.getEntriesByName(name).length === 0) performance.mark(name);
}

function windowFrom(event: Electron.IpcMainInvokeEvent) {
  return BrowserWindow.fromWebContents(event.sender);
}

function fromMainWindow(event: Electron.IpcMainInvokeEvent) {
  return mainWindow !== null && windowFrom(event) === mainWindow;
}

/** Dock/taskbar icon for unpackaged launches; packaged builds get theirs from electron-builder. */
function developmentIcon() {
  if (app.isPackaged) return undefined;
  const icon = path.join(app.getAppPath(), "assets", developmentIconFile(process.platform));
  return existsSync(icon) ? icon : undefined;
}

function sessionPartitionKey(targetUrl: string) {
  return sessionPartitionForServerUrl(targetUrl);
}

function legacyDefaultSessionFlag(partition: string) {
  return path.join(
    app.getPath("userData"),
    `legacy-default-${partition.replace(/[^a-zA-Z0-9_-]/g, "_")}.flag`,
  );
}

/**
 * Prefer the default session when that origin already has cookies or site
 * storage there, so upgrades keep localStorage/IndexedDB. Fresh origins get
 * an isolated partition.
 */
async function resolveSessionForTarget(targetUrl: string) {
  const partition = sessionPartitionKey(targetUrl);
  if (partition === null) {
    return { partition: null, value: session.defaultSession };
  }
  if (existsSync(legacyDefaultSessionFlag(partition))) {
    return { partition: null, value: session.defaultSession };
  }
  const origin = safeOrigin(targetUrl);
  if (origin !== null) {
    try {
      const defaultCookies = await session.defaultSession.cookies.get({ url: origin });
      if (defaultCookies.length > 0) {
        await writeFile(legacyDefaultSessionFlag(partition), new Date().toISOString(), "utf8");
        return { partition: null, value: session.defaultSession };
      }
    } catch {
      // Continue with a storage probe when the profile looks pre-partition.
    }
    if (defaultSessionProfileExists() && (await defaultSessionHasOriginData(origin))) {
      try {
        await writeFile(legacyDefaultSessionFlag(partition), new Date().toISOString(), "utf8");
      } catch {
        // Flag is best-effort; still stay on the default session this launch.
      }
      return { partition: null, value: session.defaultSession };
    }
  }
  return { partition, value: session.fromPartition(partition) };
}

function defaultSessionProfileExists() {
  const root = app.getPath("userData");
  return (
    existsSync(path.join(root, "Local Storage")) ||
    existsSync(path.join(root, "IndexedDB")) ||
    existsSync(path.join(root, "Cookies")) ||
    existsSync(path.join(root, "Network", "Cookies")) ||
    existsSync(path.join(root, "Cache Storage"))
  );
}

/** Page storage in the default session means a pre-partition install for this origin. */
async function defaultSessionHasOriginData(origin: string): Promise<boolean> {
  const probe = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  // Increment only after construction succeeds so a throw cannot leave the
  // counter stuck > 0 and permanently block quit on Windows/Linux.
  liveProbeWindows++;
  try {
    await probe.loadURL(origin);
    return (await probe.webContents.executeJavaScript(`(async () => {
      if (localStorage.length > 0 || sessionStorage.length > 0) return true;
      if (typeof indexedDB !== "undefined" && indexedDB.databases) {
        try {
          const databases = await indexedDB.databases();
          if (databases.length > 0) return true;
        } catch {}
      }
      if (typeof caches !== "undefined") {
        try {
          const keys = await caches.keys();
          if (keys.length > 0) return true;
        } catch {}
      }
      return false;
    })()`)) as boolean;
  } catch {
    return false;
  } finally {
    if (!probe.isDestroyed()) probe.destroy();
    liveProbeWindows--;
  }
}

function createWindow(url: string, partition: string | null) {
  markOnce("rk:main:window-create-start");
  const icon = developmentIcon();
  const win = new BrowserWindow({
    ...browserWindowOptions(process.platform),
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      ...(partition === null ? {} : { partition }),
    },
  });
  win.on("unresponsive", () =>
    reportDesktopError(new Error("Renderer unresponsive"), "desktop.unresponsive"),
  );
  mainWindow = win;
  appWindowTargets.set(win, url);
  installWindowChrome(win, process.platform);
  const targetOrigin = safeOrigin(url);
  // Intentional OAuth flows open the provider's authorize page via a named
  // window; give those and same-origin popups a normal frame. Everything else
  // opens in the system browser so a connected server cannot navigate us away.
  // Hoisted for loopback OAuth capture so MCP/in-app localhost callbacks are skipped.
  const appOrigin = targetOrigin ?? safeOrigin(url);
  win.webContents.setWindowOpenHandler(({ url: childUrl, frameName }) => {
    if (shouldOpenInAppPopup(appOrigin, childUrl, frameName)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: oauthPopupWindowOptions(partition),
      };
    }
    const external = safeExternalUrl(childUrl);
    if (external !== null) void shell.openExternal(external);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, navigationUrl) => {
    if (targetOrigin !== null && safeOrigin(navigationUrl) === targetOrigin) return;
    event.preventDefault();
    const external = safeExternalUrl(navigationUrl);
    if (external !== null) void shell.openExternal(external);
  });
  // The popup has no address bar, so a loopback redirect would otherwise strand
  // the user on a blank window holding the authorization code in a URL they
  // cannot read. Capture it here and hand it to the app instead.
  win.webContents.on("did-create-window", (popup, { frameName }) => {
    const capture = (details: {
      preventDefault: () => void;
      url: string;
      isMainFrame?: boolean;
    }) => {
      // will-redirect can fire for iframes; only the top-level callback counts.
      if (details.isMainFrame === false) return;
      const callback = oauthCallbackFrom(details.url, {
        frameName,
        excludeOrigins: appOrigin !== null ? [appOrigin] : [],
      });
      if (!callback) return;
      details.preventDefault();
      if (!win.isDestroyed()) win.webContents.send("desktop.oauth.callback", callback);
      if (!popup.isDestroyed()) popup.close();
    };
    popup.webContents.on("will-redirect", (details) => capture(details));
    popup.webContents.on("will-navigate", (details) => capture(details));
  });
  win.on("close", (event) => {
    if (
      process.platform === "darwin" &&
      !quitting &&
      process.env.RAKAZO_DISABLE_WARM_WINDOW !== "1"
    ) {
      event.preventDefault();
      win.hide();
      clearTimeout(warmWindowTimer);
      warmWindowTimer = setTimeout(() => {
        if (mainWindow === win && !win.isDestroyed() && !win.isVisible()) win.destroy();
      }, WARM_WINDOW_TTL_MS);
    }
  });
  win.once("closed", () => {
    clearTimeout(warmWindowTimer);
    if (mainWindow === win) mainWindow = null;
  });
  markOnce("rk:main:window-created");
  if (win.isVisible()) markOnce("rk:main:window-shown");
  win.once("show", () => markOnce("rk:main:window-shown"));
  win.once("ready-to-show", () => markOnce("rk:main:ready-to-show"));
  win.webContents.once("dom-ready", () => markOnce("rk:main:dom-ready"));
  win.webContents.once("did-finish-load", () => markOnce("rk:main:did-finish-load"));
  win.webContents.once("did-stop-loading", () => markOnce("rk:main:did-stop-loading"));
  markOnce("rk:main:load-url-start");
  const loaded = loadAppUrl(win, url).then(
    (state) => {
      markOnce("rk:main:load-url-resolved");
      return state;
    },
    (error: unknown) => {
      markOnce("rk:main:load-url-rejected");
      throw error;
    },
  );
  if (!launchUpdateCheckScheduled) {
    launchUpdateCheckScheduled = true;
    setTimeout(() => void desktopUpdater.check(false), LAUNCH_CHECK_DELAY_MS).unref();
    setInterval(() => void desktopUpdater.check(false), 60 * 60 * 1_000).unref();
  }
  return { loaded, win };
}

async function probeDocument(url: string): Promise<string | null> {
  // Test/dev harnesses may load data: or file: documents; only probe real servers.
  if (!url.startsWith("http://") && !url.startsWith("https://")) return null;
  try {
    const response = await net.fetch(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // Allow 3xx (e.g. / → /login); reject hard HTTP errors before opening a window.
    if (response.status >= 400) {
      return `The server answered with HTTP ${response.status}.`;
    }
    return null;
  } catch (error) {
    return probeFailureMessage(error);
  }
}

/**
 * loadURL alone treats many HTTP error documents as success. Reject main-frame
 * failures, renderer crashes during load, HTTP 4xx/5xx main-frame responses, and
 * shells that never mount application content.
 */
function loadAppUrl(win: BrowserWindow, url: string): Promise<AppDocumentState> {
  const contents = win.webContents;
  const targetSession = contents.session;
  let mainStatus: number | undefined;

  targetSession.webRequest.onCompleted({ urls: ["*://*/*"] }, (details) => {
    if (details.webContentsId === contents.id && details.resourceType === "mainFrame") {
      mainStatus = details.statusCode;
    }
  });

  return new Promise<AppDocumentState>((resolve, reject) => {
    let settled = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      contents.removeListener("did-fail-load", onFail);
      // Keep render-process-gone until document readiness finishes so a crash
      // during mount still fails the switch.
      targetSession.webRequest.onCompleted(null);
      if (error) {
        contents.removeListener("render-process-gone", onGone);
        reject(error);
        return;
      }
      if (mainStatus !== undefined && mainStatus >= 400) {
        contents.removeListener("render-process-gone", onGone);
        reject(new Error(`The server answered with HTTP ${mainStatus}.`));
        return;
      }
      void waitForMountedAppDocument(contents)
        .then((state) => {
          contents.removeListener("render-process-gone", onGone);
          if (contents.isCrashed()) {
            reject(new Error("Renderer stopped after load."));
            return;
          }
          resolve(state);
        })
        .catch((inspectError: unknown) => {
          contents.removeListener("render-process-gone", onGone);
          reject(inspectError instanceof Error ? inspectError : new Error(String(inspectError)));
        });
    };

    const onFail = (
      _event: Electron.Event,
      _errorCode: number,
      errorDescription: string,
      _validatedURL: string,
      isMainFrame: boolean,
    ) => {
      if (isMainFrame) settle(new Error(errorDescription || "Page failed to load."));
    };
    const onGone = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) => {
      settle(new Error(`Renderer stopped (${details.reason}).`));
    };

    contents.on("did-fail-load", onFail);
    contents.on("render-process-gone", onGone);
    void contents.loadURL(url).then(
      async () => {
        // onCompleted can lag loadURL; wait briefly for the main-frame status.
        const deadline = Date.now() + 500;
        while (mainStatus === undefined && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 10));
        }
        settle();
      },
      (error: unknown) => {
        settle(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function waitForMountedAppDocument(
  contents: Electron.WebContents,
): Promise<AppDocumentState> {
  const deadline = Date.now() + APP_DOCUMENT_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (contents.isCrashed()) throw new Error("Renderer stopped after load.");
    const state = (await contents.executeJavaScript(APP_DOCUMENT_STATE_SCRIPT)) as
      | AppDocumentState
      | "pending";
    if (state !== "pending") return state;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("The server page did not become ready.");
}

async function installBundledRenderer(
  targetUrl: string,
  targetSession: Session,
  partition: string | null,
  managedLocalStack: boolean,
) {
  if (!app.isPackaged || process.env.RAKAZO_DISABLE_BUNDLED_RENDERER === "1") return;
  const renderer = await resolvePackagedRenderer({userData:app.getPath("userData"),resources:process.resourcesPath,
    targetUrl,nativeVersion:app.getVersion(),managedLocalStack});
  if (!renderer) return;
  const {root,firstParty} = renderer;
  const localRoot = renderer.local ? root : null;
  const webUrl = new URL(targetUrl);
  const installationKey = `${partition ?? "default"}:${webUrl.protocol}`;
  if (bundledRendererInstallations.has(installationKey)) return;

  await targetSession.protocol.handle(webUrl.protocol.slice(0, -1), async (request) => {
    const forward = () => {
      return targetSession.fetch(request, forwardedRendererRequestInit(request, webUrl.origin));
    };
    // Self-hosted servers keep their own UI; official API/auth traffic stays on the network.
    if (!localRoot && !firstParty && currentSetup?.mode !== "new") {
      return forward();
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return forward();
    }
    const acceptsHtml = request.headers.get("accept")?.includes("text/html") ?? false;
    const candidates = bundledRendererCandidates(root, request.url, webUrl.origin, acceptsHtml, renderer.basePath);
    if (!candidates) return forward();
    for (const file of candidates) {
      let body: Buffer | null = null;
      try {
        if (localRoot && !(await realpath(file)).startsWith(root + path.sep)) throw new Error("Local frontend asset escaped its profile");
        if (request.method === "HEAD") {
          if (!(await stat(file)).isFile()) continue;
        } else {
          body = await readFile(file);
        }
      } catch (error) {
        if (isRendererAssetMiss(error)) continue;
        throw error;
      }
      return new Response(body ? new Uint8Array(body) : null, { headers: bundledRendererHeaders(file, request.url, managedLocalStack) });
    }
    return forward();
  });
  bundledRendererInstallations.add(installationKey);
  markOnce("rk:main:bundled-renderer-ready");
}

function oauthPopupWindowOptions(partition: string | null) {
  return {
    width: 560,
    height: 720,
    frame: true,
    titleBarStyle: "default" as const,
    autoHideMenuBar: true,
    backgroundColor: "#161616",
    webPreferences: oauthPopupSessionPreferences(partition),
  };
}

function createSetupWindow() {
  const icon = developmentIcon();
  const win = new BrowserWindow({
    ...setupWindowOptions(process.platform),
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(import.meta.dirname, "setup-preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // A long pull runs while this window sits behind others; throttled timers would freeze it.
      backgroundThrottling: false,
    },
  });
  setupWindow = win;
  installWindowChrome(win, process.platform);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.once("closed", () => {
    if (setupWindow === win) setupWindow = null;
    // Closing setup without saving restores a connected session (Change Server cancel).
    restoreAppWindowAfterSetup();
  });
  void win.loadFile(path.join(import.meta.dirname, "setup.html"));
  markOnce("rk:main:setup-window-created");
  return win;
}

/** Hide the app while setup is open; do not clear the saved target until a new one opens. */
function showSetupWindow(error: string | null = null, retryTarget?: string) {
  setupError = error;
  setupRetryTarget = retryTarget ?? null;

  let win: BrowserWindow;
  if (setupWindow !== null && !setupWindow.isDestroyed()) {
    if (error !== null) setupWindow.reload();
    win = setupWindow;
  } else {
    win = createSetupWindow();
  }
  if (mainWindow !== null && !mainWindow.isDestroyed()) mainWindow.hide();
  win.show();
  win.focus();
  return win;
}

function restoreAppWindowAfterSetup() {
  if (quitting) return;
  if (setupWindow !== null && !setupWindow.isDestroyed()) return;
  if (mainWindow === null || mainWindow.isDestroyed() || currentTargetUrl === null) return;
  clearTimeout(warmWindowTimer);
  mainWindow.show();
  mainWindow.focus();
}

let menuUpdateCheck: Promise<void> | null = null;

/** Works before sign-in, unlike the settings section, and answers with native alerts. */
function checkForUpdatesFromMenu() {
  // One request at a time, so repeated clicks cannot stack alerts.
  menuUpdateCheck ??= runMenuUpdateCheck().finally(() => {
    menuUpdateCheck = null;
  });
  return menuUpdateCheck;
}

async function runMenuUpdateCheck() {
  let state = await desktopUpdater.check(true);
  // A found update starts downloading on its own; wait for it so the answer can be "restart".
  if (state.phase === "available" || state.phase === "downloading") {
    state = await desktopUpdater.download();
  }
  const alert = (options: Electron.MessageBoxOptions) =>
    mainWindow && !mainWindow.isDestroyed()
      ? dialog.showMessageBox(mainWindow, options)
      : dialog.showMessageBox(options);
  if (state.phase === "ready") {
    const { response } = await alert({
      message: `Rakazo ${state.availableVersion} is ready to install.`,
      buttons: ["Restart", "Later"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return;
    const result = await installUpdate();
    if (result.message) {
      await alert({
        type: "warning",
        message: "Could not install the update.",
        detail: result.message,
      });
    }
  } else if (state.message) {
    // Offline and other failed checks settle back to idle with a message.
    await alert({
      type: "warning",
      message: "Could not check for updates.",
      detail: state.message,
    });
  } else if (state.phase === "idle") {
    await alert({ message: "Rakazo is up to date.", detail: `Version ${state.currentVersion}` });
  }
}

async function installUpdate() {
  if (desktopUpdater.state().phase !== "ready") return desktopUpdater.state();
  if (hostComputer?.hasActiveWork() || cloudComputer?.busy() || accountComputer?.busy()) return {
    ...desktopUpdater.state(), message: "A local task is still running. Install the update when it finishes.",
  };
  quitting = true;
  const state = await desktopUpdater.install();
  // A failed install stays ready for retry but reports a message. Restore normal
  // window behavior while the user keeps working after that failure.
  if (state.phase !== "ready" || state.message !== null) quitting = false;
  return state;
}

function installApplicationMenu() {
  const computerAccess: Electron.MenuItemConstructorOptions = {
    label: "Computer Access…",
    visible: currentSetup?.mode === "new",
    click: () => mainWindow?.webContents.send("desktop.computer.configure"),
  };
  const revokeComputerAccess: Electron.MenuItemConstructorOptions = {
    label: "Revoke Local Computer Access",
    visible: hostComputer?.isEnabled() === true,
    click: () => {
      const revoked = hostComputer?.revoke();
      void accountComputer?.revoke();
      void cloudComputer?.revoke(); cloudComputerOwner = undefined;
      void revoked?.finally(() => installApplicationMenu()).catch(() => undefined);
    },
  };
  const checkForUpdates: Electron.MenuItemConstructorOptions = {
    label: "Check for Updates…",
    visible: updaterSupport(updaterEnvironment).supported,
    click: () => void checkForUpdatesFromMenu(),
  };
  const changeServer: Electron.MenuItemConstructorOptions = {
    id: "change-rakazo-server",
    label: "Advanced: change server…",
    accelerator: "CmdOrCtrl+Shift+K",
    click: () => showSetupWindow(),
  };
  const stopStack: Electron.MenuItemConstructorOptions = {
    id: "stop-local-stack",
    label: "Stop Local Stack",
    // The stack keeps running after quit (bots are always on); this is the explicit off switch.
    click: () => {
      if (currentSetup?.mode === "new") {
        hostComputer?.activate(false);
        installApplicationMenu();
        void localStack.stop();
      }
    },
  };
  const viewMenu: Electron.MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      { role: "resetZoom" },
      { role: "zoomIn" },
      // zoomIn's default accelerator is Cmd/Ctrl+Plus, which needs Shift on US layouts.
      { role: "zoomIn", accelerator: "CommandOrControl+=", visible: false },
      { role: "zoomOut" },
      // macOS adds its own Enter Full Screen item to a menu named View.
      ...(process.platform === "darwin"
        ? []
        : ([{ type: "separator" }, { role: "togglefullscreen" }] as const)),
    ],
  };
  const contribute: Electron.MenuItemConstructorOptions = {
    label: "Contribute compute…",
    click: () => { if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadURL("https://www.mycellios.com/dashboard?view=contribute"); },
  };
  const template: Electron.MenuItemConstructorOptions[] =
    process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              checkForUpdates,
              { type: "separator" },
              computerAccess,
              contribute,
              revokeComputerAccess,
              changeServer,
              stopStack,
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
          { role: "editMenu" },
          viewMenu,
          {
            label: "Window",
            role: "window",
            submenu: [
              { role: "minimize" },
              { role: "zoom" },
              { role: "close" },
              { type: "separator" },
              { role: "front" },
            ],
          },
        ]
      : [
          {
            label: "File",
            submenu: [
              computerAccess,
              contribute,
              revokeComputerAccess,
              changeServer,
              stopStack,
              { type: "separator" },
              checkForUpdates,
              { type: "separator" },
              { role: "quit" },
            ],
          },
          { role: "editMenu" },
          viewMenu,
          { role: "windowMenu" },
        ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Setup IPC must only answer the setup window, never a connected Rakazo server. */
function fromSetupWindow(event: Electron.IpcMainInvokeEvent) {
  return (
    setupWindow !== null && !setupWindow.isDestroyed() && event.sender === setupWindow.webContents
  );
}

async function probeServer(rawUrl: string, signal?: AbortSignal): Promise<DesktopReachability> {
  const url = normalizeServerUrl(rawUrl);
  if (url === null) return { ok: false, error: "Enter a valid http:// or https:// address." };
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);

  try {
    const response = await net.fetch(desktopServerEndpoint(url, "/rpc/health"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: {} }),
      cache: "no-store",
      credentials: "omit",
      redirect: "manual",
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        status: response.status,
        url,
        error: "That address redirects elsewhere. Enter the final Rakazo server address.",
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        url,
        error: `The server answered with HTTP ${response.status}.`,
      };
    }
    const health = await readProbeJson(response);
    if (!isRakazoHealth(health)) {
      return {
        ok: false,
        status: response.status,
        url,
        error: "That address did not respond like a Rakazo server.",
      };
    }
    return {
      ok: true,
      status: response.status,
      url,
    };
  } catch (error) {
    return { ok: false, url, error: probeFailureMessage(error) };
  }
}

/** A public health response is not enough: another checkout may own the same fixed port. */
async function probeManagedStack(
  rawUrl: string,
  token: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = normalizeServerUrl(rawUrl);
  // Never put the private stack token on a cleartext LAN or .local hop.
  if (url === null || !maySendDesktopStackToken(url)) return null;
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  try {
    const response = await net.fetch(`${url}${DESKTOP_STACK_PROBE_PATH}`, {
      method: "GET",
      headers: { [DESKTOP_STACK_TOKEN_HEADER]: token },
      cache: "no-store",
      credentials: "omit",
      redirect: "manual",
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
    if (!response.ok) return null;
    return desktopStackImageTag(await readProbeJson(response));
  } catch {
    return null;
  }
}

function openFailureDetail(error: unknown): string {
  if (error instanceof Error) {
    const { message } = error;
    if (
      message.startsWith("The server answered with HTTP") ||
      message.startsWith("The server page loaded empty") ||
      message.startsWith("The server page did not become ready") ||
      message.startsWith("Renderer stopped") ||
      message.startsWith("Page failed to load")
    ) {
      return message;
    }
  }
  return probeFailureMessage(error);
}

function activateDesktopMonitoring(url: string | undefined, targetSession?: Session) {
  if (monitoringTargetUrl === url && monitoringSession === targetSession) return;
  stopMonitoringSession?.();
  stopMonitoringSession = undefined;
  monitoringTargetUrl = url;
  monitoringSession = targetSession;
  if (!url || !targetSession) {
    disableDesktopMonitoring();
    return;
  }
  const fetchMonitoringConfig = () =>
    targetSession.fetch(desktopServerEndpoint(url, "/api/monitoring/config"), {
      signal: AbortSignal.timeout(8_000),
    });
  const refreshMonitoringUser = () => {
    if (monitoringSession === targetSession && monitoringTargetUrl === url)
      void refreshDesktopMonitoringUser(fetchMonitoringConfig);
  };
  targetSession.cookies.on("changed", refreshMonitoringUser);
  stopMonitoringSession = () =>
    targetSession.cookies.removeListener("changed", refreshMonitoringUser);
  void configureDesktopMonitoring(fetchMonitoringConfig, {
    version: app.getVersion(),
    base: url,
  });
}

async function openAppOnce(targetUrl: string, switching: boolean) {
  projectRunner?.reset();
  targetUrl = desktopEntryUrl(targetUrl);
  cloudComputer?.stop(); cloudComputer = undefined; cloudComputerOwner = undefined;
  if (!accountComputer?.online() || switching) {
    hostComputer?.activate(currentSetup?.mode === "new" && targetUrl === localStack.webUrl());
  }
  const target = await resolveSessionForTarget(targetUrl);
  target.value.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    for (const name of Object.keys(headers)) if (name.toLowerCase() === "content-security-policy")
      headers[name] = headers[name]!.map(policy => desktopProjectPolicy(details.url, details.resourceType, policy));
    callback({ responseHeaders: headers });
  });
  // A failed switch must leave telemetry with the window that remains selected.
  if (mainWindow === null) activateDesktopMonitoring(targetUrl, target.value);
  const previous = mainWindow;
  let win: BrowserWindow | null = null;
  try {
    const documentError = await probeDocument(targetUrl);
    if (documentError !== null) {
      throw new Error(documentError);
    }
    await installBundledRenderer(
      targetUrl,
      target.value,
      target.partition,
      currentSetup?.mode === "new",
    );
    const created = createWindow(targetUrl, target.partition);
    win = created.win;
    // On launch the web app's error screen stays up so its Refresh can recover;
    // switching to a server that cannot render keeps the previous one instead.
    if ((await created.loaded) === "failed" && switching) {
      throw new Error("The server page did not become ready.");
    }
    currentTargetUrl = targetUrl;
    activateDesktopMonitoring(targetUrl, target.value);
    setupError = null;
    // Keep the previous window until the caller commits (after setup.json is written).
    pendingPreviousWindow =
      previous !== null && !previous.isDestroyed() && previous !== win ? previous : null;
    if (pendingPreviousWindow !== null) pendingPreviousWindow.hide();
    return true;
  } catch (error) {
    reportDesktopError(error, "desktop.startup");
    pendingPreviousWindow = null;
    // Keep the previous app window so Cancel / close can restore it.
    if (previous !== null && !previous.isDestroyed()) mainWindow = previous;
    // Show the setup window BEFORE destroying the failed one: on Windows/Linux,
    // destroying the last window fires "window-all-closed" -> app.quit() before
    // showSetupWindow() runs, so the app silently exits instead of showing this error.
    showSetupWindow(`Could not open that server. ${openFailureDetail(error)}`, switching ? undefined : targetUrl);
    if (win !== null && !win.isDestroyed()) win.destroy();
    return false;
  }
}

function syncHostComputerAccess() {
  hostComputer?.activate(
    currentSetup?.mode === "new" &&
      mainWindow !== null &&
      !mainWindow.isDestroyed() &&
      appWindowTargets.get(mainWindow) === localStack.webUrl(),
  );
  installApplicationMenu();
}

/** Drop the previous app window after the new server is opened and persisted. */
function commitPendingAppSwitch() {
  syncHostComputerAccess();
  const previous = pendingPreviousWindow;
  pendingPreviousWindow = null;
  if (previous !== null && !previous.isDestroyed() && previous !== mainWindow) previous.destroy();
}

/**
 * Undo an open that could not be persisted. When a prior session exists, restore
 * it. On first run keep the connected window so the user can retry save.
 */
function abandonPendingAppSwitch(
  previousSetup: DesktopSetup | null,
  previousUrl: string | null,
): "restored" | "kept" {
  const previous = pendingPreviousWindow;
  pendingPreviousWindow = null;
  if (previous !== null && !previous.isDestroyed()) {
    const failed = mainWindow;
    if (failed !== null && !failed.isDestroyed() && failed !== previous) failed.destroy();
    mainWindow = previous;
    currentSetup = previousSetup;
    currentTargetUrl = previousUrl;
    activateDesktopMonitoring(previousUrl ?? undefined, previous.webContents.session);
    syncHostComputerAccess();
    // If setup was already closed (e.g. during a slow write), make the restored
    // session visible — otherwise macOS can be left with no shown window.
    if (setupWindow === null || setupWindow.isDestroyed()) {
      clearTimeout(warmWindowTimer);
      previous.show();
      previous.focus();
    }
    return "restored";
  }
  return "kept";
}

/** Watch for a renderer crash until setup is persisted (or the switch is abandoned). */
function watchRendererUntilCommitted(win: BrowserWindow) {
  let crashed = false;
  const onGone = () => {
    crashed = true;
  };
  win.webContents.once("render-process-gone", onGone);
  return {
    crashed: () => crashed || (!win.isDestroyed() && win.webContents.isCrashed()),
    dispose: () => {
      if (!win.isDestroyed()) win.webContents.removeListener("render-process-gone", onGone);
    },
  };
}

function destroySetupWindow() {
  const setup = setupWindow;
  setupWindow = null;
  if (setup !== null && !setup.isDestroyed()) setup.destroy();
}

/** Best-effort restore of setup.json after a failed save that already wrote disk. */
async function rollbackSetupFile(userDataDir: string, previousSetup: DesktopSetup | null) {
  try {
    if (previousSetup !== null) await writeSetup(userDataDir, previousSetup);
    else await clearSetup(userDataDir);
  } catch {
    // Disk rollback is best-effort; callers already restored in-memory state when possible.
  }
}

/**
 * After a renderer crash around save: restore prior setup when possible, otherwise
 * drop the crashed first-run window so setup remains the only recovery surface.
 */
async function recoverFromCrashedSave(
  userDataDir: string,
  previousSetup: DesktopSetup | null,
  previousUrl: string | null,
): Promise<string> {
  const outcome = abandonPendingAppSwitch(previousSetup, previousUrl);
  await rollbackSetupFile(userDataDir, previousSetup);
  if (outcome === "kept") {
    if (mainWindow !== null && !mainWindow.isDestroyed()) mainWindow.destroy();
    mainWindow = null;
    currentSetup = previousSetup;
    currentTargetUrl = previousUrl;
    if (previousUrl) {
      const restored = await resolveSessionForTarget(previousUrl);
      activateDesktopMonitoring(previousUrl, restored.value);
    } else activateDesktopMonitoring(undefined);
  }
  const message =
    previousSetup !== null
      ? "Could not open that server. Renderer stopped. The previous instance was restored for the next launch."
      : "Could not open that server. Renderer stopped.";
  showSetupWindow(message);
  return message;
}

function safeOrigin(targetUrl: string) {
  try {
    return new URL(targetUrl).origin;
  } catch {
    return null;
  }
}

// A second launch on Linux/Windows would rerun host-computer setup, overwrite
// the saved token and restart the local stack under the running instance.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = secondInstanceWindow(setupWindow, mainWindow);
    if (win === null) return;
    revealSecondInstanceWindow(win);
  });
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  installSessionPermissions(session.defaultSession, permissionTarget);
  const userDataDir = app.getPath("userData");
  contributionRuntime = new ContributionRuntime({
    platform: process.platform,
    resources: process.resourcesPath,
    userData: userDataDir,
    programFiles: process.env.ProgramFiles ?? "C:\\Program Files",
    programData: process.env.ProgramData ?? "C:\\ProgramData",
  });
  try {
    hostComputer = await prepareHostComputer(userDataDir);
  } catch {
    /* Local access fails closed; Docker remains available. */
  }
  localStack = new LocalStackController({
    hostComputer: hostComputer?.connection,
    platform: process.platform,
    env: process.env,
    exists: existsSync,
    run: runDocker,
    stackDir: stackDir(userDataDir),
    resourceDir: stackResourceDir({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    }),
    localWebUrl:
      process.env.RAKAZO_LOCAL_WEB_URL?.trim() ||
      (await readStackWebUrl(stackDir(userDataDir), LOCAL_WEB_URL)),
    imageTag: resolveImageTag({
      version: app.getVersion(),
      packaged: app.isPackaged,
      override: process.env.RAKAZO_IMAGE_TAG,
    }),
    probe: (url, signal, token) => probeManagedStack(url, token, signal),
    randomHex: (bytes) => randomBytes(bytes).toString("hex"),
    onState: (state) => {
      if (setupWindow !== null && !setupWindow.isDestroyed()) {
        setupWindow.webContents.send("desktop.setup.stack.changed", state);
      }
    },
  });
  const nativeRoot = app.isPackaged
    ? path.join(process.resourcesPath, "local-server")
    : path.join(app.getAppPath(), "local-server");
  // Existing Compose installations retain their database, ports, and service lifecycle.
  if (
    !existsSync(path.join(stackDir(userDataDir), ".env")) &&
    existsSync(path.join(nativeRoot, "dist", "desktop-local-entry.js"))
  ) {
    localStack = new LocalNativeStackController({
      dataDir: path.join(userDataDir, "local-data"),
      stackDir: stackDir(userDataDir),
      webRoot: app.isPackaged
        ? path.join(process.resourcesPath, "web")
        : path.resolve(app.getAppPath(), "../web/dist"),
      migrationsRoot: nativeRoot,
      localWebUrl: await readStackWebUrl(stackDir(userDataDir), LOCAL_WEB_URL),
      build: app.getVersion(),
      hostComputer: hostComputer?.connection,
      launch: (configFile) =>
        utilityProcess.fork(path.join(nativeRoot, "dist", "desktop-local-entry.js"), [], {
          env: {
            ...nativeEnvironment(),
            NODE_ENV: "production",
            RAKAZO_LOCAL_SERVER_CONFIG: configFile,
          },
          serviceName: "Local agent server",
          stdio: "pipe",
        }),
      onState: (state) => {
        if (setupWindow && !setupWindow.isDestroyed())
          setupWindow.webContents.send("desktop.setup.stack.changed", state);
      },
    });
  }
  currentSetup = await readSetup(userDataDir);
  const target = resolveStartupTarget({
    envUrl: process.env.RAKAZO_WEB_URL,
    saved: currentSetup,
    forceSetup: process.env.RAKAZO_FORCE_SETUP === "1",
  });
  if (process.env.RAKAZO_PERFORMANCE_CLEAR_CACHE === "1") {
    const cacheSessions = new Set<Session>([session.defaultSession]);
    if (target.kind === "app") {
      cacheSessions.add((await resolveSessionForTarget(target.url)).value);
    }
    await Promise.all(
      [...cacheSessions].flatMap((value) => [value.clearCache(), value.clearCodeCaches({})]),
    );
    markOnce("rk:main:caches-cleared");
  }

  const icon = developmentIcon();
  if (process.platform === "darwin" && icon) app.dock?.setIcon(icon);
  installApplicationMenu();
  const browserAuthAttempts = new Map<string, AbortController>();
  const contributionRequest = (event: Electron.IpcMainInvokeEvent) =>
    fromMainWindow(event) && event.senderFrame !== null &&
    mayManageContribution(event.senderFrame.url, event.senderFrame === event.sender.mainFrame);
  ipcMain.handle("desktop.runtime.status", (event) => {
    if (!contributionRequest(event)) throw new Error("Contribution requires the Mycellios application.");
    return contributionRuntime.status();
  });
  ipcMain.handle("desktop.runtime.enroll", (event, bundle: unknown) => {
    if (!contributionRequest(event)) throw new Error("Contribution requires the Mycellios application.");
    return contributionRuntime.enroll(bundle);
  });
    ipcMain.handle("desktop.runtime.identify", (event) => {
      if (!contributionRequest(event)) throw new Error("Contribution requires the Mycellios application.");
      return contributionRuntime.identify();
    });
  const cancelBrowserAuth = () => {
    for (const attempt of browserAuthAttempts.values()) attempt.abort();
    browserAuthAttempts.clear();
  };
  app.on("before-quit", cancelBrowserAuth);
  ipcMain.handle("desktop.oauth.open", async (event, url: unknown) => {
    if (
      !fromMainWindow(event) ||
      event.senderFrame !== event.sender.mainFrame ||
      typeof url !== "string" ||
      url.length > 16_384
    )
      throw new Error("Invalid sign-in request.");
    if (browserAuthAttempts.has(url) || browserAuthAttempts.size >= 8) {
      throw new Error("A sign-in attempt is already active. Cancel it and retry.");
    }
    const controller = new AbortController();
    browserAuthAttempts.set(url, controller);
    const stop = () => controller.abort();
    const expiry = setTimeout(stop, 10 * 60_000);
    expiry.unref();
    event.sender.once("destroyed", stop);
    event.sender.once("did-navigate", stop);
    controller.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(expiry);
        event.sender.removeListener("destroyed", stop);
        event.sender.removeListener("did-navigate", stop);
        if (browserAuthAttempts.get(url) === controller) browserAuthAttempts.delete(url);
      },
      { once: true },
    );
    try {
      await openBrowserAuth(url, {
        signal: controller.signal,
        onClose: stop,
        openExternal: (target) => shell.openExternal(target),
        onCallback: (callback) => {
          if (!event.sender.isDestroyed()) event.sender.send("desktop.oauth.callback", callback);
        },
      });
    } catch {
      controller.abort();
      throw new Error("Could not open browser sign-in. Close other sign-in attempts and retry.");
    }
  });
  ipcMain.handle("desktop.oauth.cancel", (event, url: unknown) => {
    if (
      !fromMainWindow(event) ||
      event.senderFrame !== event.sender.mainFrame ||
      typeof url !== "string"
    )
      return;
    browserAuthAttempts.get(url)?.abort();
  });
  const isManagedComputerRequest = (event: Electron.IpcMainInvokeEvent) =>
    fromMainWindow(event) &&
    event.senderFrame === event.sender.mainFrame &&
    currentSetup?.mode === "new" &&
    appWindowTargets.get(mainWindow!) === localStack.webUrl() &&
    safeOrigin(event.senderFrame.url) === safeOrigin(localStack.webUrl());
  const projectServer = () => mainWindow ? normalizeServerUrl(appWindowTargets.get(mainWindow) ?? "") : null;
  const isCloudComputerRequest = (event: Electron.IpcMainInvokeEvent) => {
    const server = projectServer();
    if (!server || currentSetup?.mode === "new" || !fromMainWindow(event) || event.senderFrame !== event.sender.mainFrame) return false;
    const base = new URL(server), page = new URL(event.senderFrame.url);
    const prefix = base.pathname.replace(/\/$/, "");
    return page.origin === base.origin && (page.pathname === prefix || page.pathname.startsWith(prefix + "/"));
  };
  const getCloudComputer = () => {
    if (!hostComputer || !mainWindow) throw new Error("Local computer unavailable");
    const base = projectServer();
    if (!base) throw new Error("Open the configured server first.");
    if (cloudComputer && cloudComputerBase !== base) {
      cloudComputer.stop(); cloudComputer = undefined; cloudComputerOwner = undefined; hostComputer.activate(false);
    }
    const nativeSession = mainWindow.webContents.session;
    const owningWindow = mainWindow;
    cloudComputerBase = base;
    cloudComputer ??= new DesktopRelayClient({ base,
      fetch: async (url, init) => {
        const spaceId = await nativeProjectSpace(owningWindow);
        if(mainWindow !== owningWindow || projectServer() !== base)throw new Error("The server session changed.");
        const headers = new Headers(init?.headers);
        if(spaceId)headers.set("x-rakazo-space-id",spaceId);else headers.delete("x-rakazo-space-id");
        return nativeSession.fetch(url, { ...init, headers, bypassCustomProtocolHandlers: true });
      },
      localUrl: hostComputer.connection.url.replace("host.docker.internal", "127.0.0.1"), localToken: hostComputer.connection.token,
      revoked: () => { cloudComputerOwner = undefined; if(!accountComputer?.online())hostComputer?.activate(false); },
    });
    return cloudComputer;
  };
  if(hostComputer) accountComputer = installAccountComputerBackground({
    profile:userDataDir,host:hostComputer,
    localUrl:hostComputer.connection.url.replace("host.docker.internal","127.0.0.1"),localToken:hostComputer.connection.token,
    consentScope:computerConsentScope,window:()=>mainWindow,changed:installApplicationMenu,
    context:async()=>{
      if(currentSetup?.mode === "new")return null;
      const base=projectServer() ?? normalizeServerUrl(currentSetup?.serverUrl ?? currentTargetUrl ?? (target.kind === "app" ? target.url : ""));
      if(!base)return null;
      if(mainWindow && projectServer()===base)accountComputerSession={base,session:mainWindow.webContents.session};
      const nativeSession=accountComputerSession?.base===base?accountComputerSession.session:undefined;
      if(!nativeSession)return null;
      return {base,fetch:(url,init)=>nativeSession.fetch(url,{...init,bypassCustomProtocolHandlers:true})};
    },
  });
  const projectBrowser = installProjectBrowser({
    getWindow: () => mainWindow,
    authorize: event => isCloudComputerRequest(event) || isManagedComputerRequest(event),
    scope: async () => {
      const captured = mainWindow;
      if (!captured || captured.isDestroyed()) throw new Error("Open the application first.");
      const context = await nativePreviewContext(captured);
      if (mainWindow !== captured) throw new Error("The application changed.");
      const url = new URL(captured.webContents.getURL());
      return JSON.stringify([projectServer(), url.pathname, url.searchParams.get("task"), context]);
    },
  });
  app.once("before-quit", () => projectBrowser.dispose());
  let projectConversations: ReturnType<typeof installProjectConversations> | undefined;
  projectRunner = installProjectRunner({
    storage: path.join(userDataDir, "project-runs"),
    leaseValid: () => hostComputer?.isEnabled() === true && (currentSetup?.mode === "new" || Boolean(cloudComputerOwner)),
    context: async (event, botId) => {
      if ((!isCloudComputerRequest(event) && !isManagedComputerRequest(event)) || !hostComputer?.isEnabled() || !mainWindow)
        throw new Error("Connect this agent to the local computer first.");
      const captured = mainWindow;
      const capturedUrl = captured.webContents.getURL(), projectRoute = new URL(capturedUrl);
      const pathname = projectRoute.pathname;
      if (pathname.split("/").filter(Boolean).at(-1) !== botId) throw new Error("Open this agent's chat first.");
      let owner: string;
      if (isCloudComputerRequest(event)) {
        const client = getCloudComputer();
        owner = JSON.stringify(await client.identity());
        if (owner !== cloudComputerOwner || !(accountComputer?.connected(botId,await nativeProjectSpace(captured)) ?? client.connected(botId))) throw new Error("Reconnect this agent to the local computer.");
      } else {
        if (!await localStack.matchesDesiredStack()) throw new Error("The local session changed.");
        owner = JSON.stringify(await nativePreviewContext(captured));
      }
      if (mainWindow !== captured || captured.isDestroyed() || captured.webContents.getURL() !== capturedUrl || event.senderFrame?.url !== capturedUrl || !hostComputer.isEnabled())
        throw new Error("The application session changed.");
      const taskId = projectRoute.searchParams.get("task");
      const taskFolder = taskId ? await projectConversations?.taskFolder(botId, taskId) : undefined;
      if (mainWindow !== captured || captured.isDestroyed() || captured.webContents.getURL() !== capturedUrl || !hostComputer.isEnabled())
        throw new Error("The project conversation changed.");
      if (taskId && taskFolder === undefined) throw new Error("Connect this project conversation before starting its preview.");
      return { key: JSON.stringify(taskId ? [projectServer(), owner, botId, taskId] : [projectServer(), owner, botId]), workspace: taskFolder ?? hostComputer.workspace(botId), selected: taskFolder ?? hostComputer.project(botId)?.path };
    },
  });
  app.once("before-quit", () => projectRunner?.dispose());
  const connectLocalComputer = async (botId: unknown) => {
    if (typeof botId !== "string" || !botId || botId.length > 256) throw new Error("Invalid agent");
    if (!hostComputer?.isEnabled()) throw new Error("Enable local computer access first.");
    if (currentSetup?.mode === "new" && await localStack.matchesDesiredStack()) return;
    const client = getCloudComputer(), owner = cloudComputerOwner;
    if (!owner || JSON.stringify(await client.identity()) !== owner) throw new Error("Allow local computer access first.");
    if(accountComputer)await accountComputer.connect(botId,mainWindow?await nativeProjectSpace(mainWindow):null);
    else await client.bind(botId);
    if (cloudComputerOwner !== owner || !hostComputer.isEnabled()) {
      await client.revoke(); throw new Error("The local session changed.");
    }
  };
  const persistHostChoice = async (computerHost: "docker" | "this-mac") => {
    const origin = new URL(localStack.webUrl()).origin;
    const token = await readStackToken(stackDir(app.getPath("userData")));
    if (!token || !(await localStack.matchesDesiredStack()))
      throw new Error("Local server is unavailable");
    await saveLocalComputerHost({ origin, token }, computerHost, (input, init) =>
      net.fetch(input instanceof URL ? input.href : input, {
        ...init,
        bypassCustomProtocolHandlers: true,
      }),
    );
  };
  ipcMain.handle("desktop.computer.requestAccess", async (event) => {
    if (isCloudComputerRequest(event) && hostComputer) {
      if (requestingComputerAccess) return false;
      requestingComputerAccess = true;
      try {
        const client = getCloudComputer();
        const identity = await client.identity();
        const owner = JSON.stringify(identity);
        if (cloudComputerOwner === owner && hostComputer.isEnabled()) {
          await accountComputer?.refresh();
          return hostComputer.isEnabled();
        }
        const consentScope = computerConsentScope(projectServer()!, identity);
        if (hostComputer.hasRememberedAccess(consentScope)) {
          if (!isCloudComputerRequest(event) || JSON.stringify(await client.identity()) !== owner) return false;
          await hostComputer.grant(consentScope);
          if (!isCloudComputerRequest(event) || JSON.stringify(await client.identity()) !== owner) {
            hostComputer.activate(false);
            cloudComputerOwner = undefined;
            return false;
          }
          hostComputer.activate(true);
          cloudComputerOwner = owner;
          await accountComputer?.refresh();
          installApplicationMenu();
          return hostComputer.isEnabled();
        }
        const result = await dialog.showMessageBox(mainWindow!, {
          type: "warning", title: "Use this computer?", message: "Allow your Mycellios agents to work on this computer?",
          detail: "Micos you connect can run commands and read or change local files with your account's permissions. Each Mico starts in its own working folder; no folder selection is required. Your cloud chats and credits stay in Mycellios. Revoke access from the File menu at any time.",
          buttons: ["Cancel", "Allow"], defaultId: 0, cancelId: 0, noLink: true,
        });
        if (result.response !== 1 || !isCloudComputerRequest(event) || JSON.stringify(await client.identity()) !== owner) return false;
        await hostComputer.grant(consentScope); hostComputer.activate(true); cloudComputerOwner = owner;
        await accountComputer?.refresh();
        installApplicationMenu(); return hostComputer.isEnabled();
      } finally { requestingComputerAccess = false; }
    }
    if (!isManagedComputerRequest(event) || !hostComputer)
      throw new Error("Local computer access requires an app-managed local instance.");
    if (requestingComputerAccess) return false;
    requestingComputerAccess = true;
    try {
      if (!(await localStack.matchesDesiredStack()) || !isManagedComputerRequest(event))
        return false;
      if (hostComputer.isEnabled()) {
        await persistHostChoice("this-mac");
        return true;
      }
      const result = await dialog.showMessageBox(mainWindow!, {
        type: "warning",
        title: "Allow local computer access?",
        message: "Allow bots to use this computer?",
        detail:
          "Bots on this local instance can run commands, read and change files, and launch apps with your account’s permissions. You can revoke access from the app menu.",
        buttons: ["Cancel", "Allow"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (result.response !== 1 || !isManagedComputerRequest(event)) return false;
      hostComputer.activate(true);
      await hostComputer.grant();
      try {
        await persistHostChoice("this-mac");
      } catch (error) {
        await hostComputer.revoke();
        throw error;
      }
      installApplicationMenu();
      return hostComputer.isEnabled();
    } finally {
      requestingComputerAccess = false;
    }
  });
  ipcMain.handle("desktop.computer.projectAvailable", async (event) => {
    if (isManagedComputerRequest(event)) return true;
    // Show the native connection action before consent or network readiness.
    // requestAccess/connect still authenticate and enforce the actual grant.
    return isCloudComputerRequest(event) && hostComputer !== undefined;
  });
  ipcMain.handle("desktop.computer.project", async (event, botId: unknown) => {
    if ((!isManagedComputerRequest(event) && !isCloudComputerRequest(event)) || !hostComputer?.isEnabled() || typeof botId !== "string")
      return null;
    if (isCloudComputerRequest(event) && (!cloudComputerOwner || JSON.stringify(await getCloudComputer().identity()) !== cloudComputerOwner)) return null;
    return hostComputer.project(botId);
  });
  ipcMain.handle("desktop.computer.connected", async (event, botId: unknown) => {
    if (typeof botId !== "string" || !botId || botId.length > 256 || !hostComputer?.isEnabled()) return false;
    if (isManagedComputerRequest(event)) return true;
    if (!isCloudComputerRequest(event) || !cloudComputerOwner) return false;
    const client = getCloudComputer();
    if (JSON.stringify(await client.identity()) !== cloudComputerOwner) return false;
    return accountComputer?.connected(botId,await nativeProjectSpace(mainWindow!)) ?? client.connected(botId);
  });
  ipcMain.handle("desktop.computer.connect", async (event, botId: unknown) => {
    if (!isCloudComputerRequest(event) && !isManagedComputerRequest(event)) throw new Error("Open the configured application first.");
    await connectLocalComputer(botId);
  });
  ipcMain.handle("desktop.computer.chooseProject", async (event, botId: unknown) => {
    if (!isCloudComputerRequest(event) && !isManagedComputerRequest(event)) throw new Error("Open the configured application first.");
    if(typeof botId!=="string" || !hostComputer?.isEnabled())throw new Error("Enable local computer access first.");
    const selected=await dialog.showOpenDialog(mainWindow!,{title:"Open project",properties:["openDirectory"]});
    if(selected.canceled || !selected.filePaths[0])return null;
    if(isCloudComputerRequest(event)) {
      const client=getCloudComputer();if(JSON.stringify(await client.identity())!==cloudComputerOwner)throw new Error("The account changed.");
      assertProjectGrant(hostComputer.project(botId),await realpath(selected.filePaths[0]));
      const project=await hostComputer.selectProject(botId,selected.filePaths[0]);await connectLocalComputer(botId);return project;
    }
    if(!isManagedComputerRequest(event) || !await localStack.matchesDesiredStack())throw new Error("The local session changed.");
    return hostComputer.selectProject(botId,selected.filePaths[0]);
  });
  if (hostComputer) projectConversations = installProjectConversations({
    storage: path.join(userDataDir, "project-conversations"), host: hostComputer,
    context: async event => {
      if ((!isCloudComputerRequest(event) && !isManagedComputerRequest(event)) || !hostComputer?.isEnabled() || !mainWindow)
        throw new Error("Connect Desktop before opening a project conversation.");
      const window = mainWindow, base = projectServer();
      if (!base) throw new Error("The project server is unavailable.");
      const spaceId = await nativeProjectSpace(window);
      return { window, base, spaceId, validate: async () => {
        if (mainWindow !== window || window.isDestroyed() || projectServer() !== base ||
          !hostComputer?.isEnabled() || await nativeProjectSpace(window) !== spaceId)
          throw new Error("The project session changed.");
      } };
    },
  });
  ipcMain.handle("desktop.computer.revokeAccess", async (event) => {
    if (isCloudComputerRequest(event)) {
      cloudComputerOwner = undefined; const revoked=hostComputer?.revoke(); await accountComputer?.revoke(); await cloudComputer?.revoke(); await revoked; installApplicationMenu(); return;
    }
    if (isManagedComputerRequest(event)) {
      try {
        await persistHostChoice("docker");
      } finally {
        await hostComputer?.revoke();
        installApplicationMenu();
      }
    }
  });
  ipcMain.handle(
    "desktop.badge.set",
    createBadgeHandler(permissionTarget, (count) => app.setBadgeCount(count)),
  );
  ipcMain.handle("desktop.platform", () => process.platform);
  ipcMain.handle("desktop.passkeys.rpIds", () => passkeyRpIds);
  ipcMain.handle("desktop.window.close", (event) => {
    windowFrom(event)?.close();
  });
  ipcMain.handle("desktop.window.minimize", (event) => {
    windowFrom(event)?.minimize();
  });
  ipcMain.handle("desktop.window.toggleMaximize", (event) => {
    const win = windowFrom(event);
    if (!win) return;
    if (win.isMaximized() || win.isFullScreen()) {
      win.setFullScreen(false);
      if (win.isMaximized()) win.unmaximize();
    } else {
      win.maximize();
    }
  });
  ipcMain.handle("desktop.window.state", (event) => {
    const win = windowFrom(event);
    return {
      minimized: win?.isMinimized() ?? false,
      maximized: win?.isMaximized() ?? false,
      fullScreen: win?.isFullScreen() ?? false,
    };
  });
  ipcMain.handle("desktop.update.state", () => desktopUpdater.state());
  ipcMain.handle("desktop.update.check", (event) =>
    fromMainWindow(event) ? desktopUpdater.check(true) : desktopUpdater.state(),
  );
  ipcMain.handle("desktop.update.download", (event) =>
    fromMainWindow(event) ? desktopUpdater.download() : desktopUpdater.state(),
  );
  ipcMain.handle("desktop.update.install", (event) =>
    fromMainWindow(event) ? installUpdate() : desktopUpdater.state(),
  );
  ipcMain.handle("desktop.setup.state", (event) => {
    if (!fromSetupWindow(event)) return null;
    return {
      defaultLocalUrl: localStack.webUrl(),
      cloudUrl: RAKAZO_CLOUD_URL,
      saved: currentSetup,
      error: setupError ?? undefined,
      recovery: setupRetryTarget !== null,
    };
  });

  ipcMain.handle("desktop.setup.retry", async (event) => {
    if (!fromSetupWindow(event) || setupRetryTarget === null)
      return { ok: false };
    if (setupSaveInProgress || appOpener.busy()) return { ok: false };
    const targetUrl = setupRetryTarget;
    const opened = await appOpener.open(targetUrl);
    if (opened) {
      commitPendingAppSwitch();
      destroySetupWindow();
    }
    return { ok: opened };
  });

  ipcMain.handle("desktop.setup.test", async (event, url: unknown) => {
    if (!fromSetupWindow(event)) return { ok: false, error: "Setup is not active." };
    if (typeof url !== "string") return { ok: false, error: "Enter a server address." };
    return probeServer(url);
  });

  ipcMain.handle("desktop.setup.save", async (event, payload: unknown) => {
    if (!fromSetupWindow(event)) return { ok: false, error: "Setup is not active." };
    // A launch still loading counts too: the switch must open and check its own server.
    if (setupSaveInProgress || appOpener.busy())
      return { ok: false, error: "A connection attempt is already running." };
    setupSaveInProgress = true;
    const previousSetup = currentSetup;
    const previousUrl = currentTargetUrl;
    try {
      const setup = parseSetupInput(payload);
      if (setup === null) {
        return {
          ok: false,
          error:
            "Enter a valid server address. Public servers require HTTPS; a new local instance must use localhost.",
        };
      }

      // Only open the exact origin selected and authenticated by the managed stack.
      let openSetup = setup;
      if (setup.mode === "new") {
        const managedUrl = managedLocalOpenUrl(setup.serverUrl, localStack.webUrl());
        if (managedUrl === null || !(await localStack.matchesDesiredStack())) {
          return {
            ok: false,
            error: "The app-managed Rakazo services are not ready. Retry setup.",
          };
        }
        openSetup = { mode: "new", serverUrl: managedUrl };
      }

      const reachability = await probeServer(openSetup.serverUrl);
      if (!reachability.ok) return { ok: false, error: reachability.error };

      // Open before persisting so a failed renderer load keeps the last working setup.
      currentSetup = openSetup;
      const opened = await appOpener.open(openSetup.serverUrl, { switching: true });
      if (!opened) {
        currentSetup = previousSetup;
        syncHostComputerAccess();
        return {
          ok: false,
          error: "Could not open that server. The previous instance was left unchanged.",
        };
      }

      const appWindow = mainWindow;
      const rendererWatch =
        appWindow !== null && !appWindow.isDestroyed()
          ? watchRendererUntilCommitted(appWindow)
          : null;
      try {
        await writeSetup(userDataDir, openSetup);
        if (rendererWatch?.crashed()) {
          const message = await recoverFromCrashedSave(userDataDir, previousSetup, previousUrl);
          return { ok: false, error: message };
        }
        // Commit while the crash listener is still armed.
        commitPendingAppSwitch();
        if (rendererWatch?.crashed()) {
          const message = await recoverFromCrashedSave(userDataDir, previousSetup, previousUrl);
          return { ok: false, error: message };
        }
        destroySetupWindow();
        // Final check after setup closes — a crash in this gap still rolls back.
        if (rendererWatch?.crashed()) {
          const message = await recoverFromCrashedSave(userDataDir, previousSetup, previousUrl);
          return { ok: false, error: message };
        }
        return { ok: true };
      } catch {
        const outcome = abandonPendingAppSwitch(previousSetup, previousUrl);
        return {
          ok: false,
          error:
            outcome === "restored"
              ? "Could not save setup. The previous instance was restored."
              : "Connected, but could not save setup for the next launch. Try Continue again.",
        };
      } finally {
        rendererWatch?.dispose();
      }
    } finally {
      setupSaveInProgress = false;
    }
  });

  ipcMain.handle("desktop.setup.quit", (event) => {
    if (fromSetupWindow(event)) app.quit();
  });
  ipcMain.handle("desktop.setup.openLink", async (event, link: unknown) => {
    if (!fromSetupWindow(event) || !isDesktopSetupLink(link)) return;
    await shell.openExternal(DOCKER_INSTALL_LINKS[link]);
  });
  ipcMain.handle("desktop.setup.stack.state", (event) =>
    fromSetupWindow(event) ? localStack.state() : null,
  );
  ipcMain.handle("desktop.setup.stack.start", (event) => {
    if (!fromSetupWindow(event)) return null;
    // Respond right away; the setup window polls `stack.state` until a terminal phase.
    void localStack.start();
    return localStack.state();
  });

  // Register before startup awaits so macOS dock clicks during probe/open are handled.
  app.on("activate", () => {
    if (setupWindow !== null && !setupWindow.isDestroyed()) {
      setupWindow.show();
      setupWindow.focus();
      return;
    }
    if (mainWindow !== null && !mainWindow.isDestroyed()) {
      clearTimeout(warmWindowTimer);
      mainWindow.show();
      mainWindow.focus();
      return;
    }
    if (appOpener.busy()) return;
    if (currentTargetUrl === null) showSetupWindow(setupError, setupRetryTarget ?? undefined);
    else
      void appOpener.open(currentTargetUrl).then((opened) => {
        if (opened) commitPendingAppSwitch();
      });
  });

  if (target.kind === "setup") {
    showSetupWindow();
  } else if (target.source === "saved") {
    if (currentSetup?.mode === "new") {
      const managedUrl = managedLocalOpenUrl(target.url, localStack.webUrl());
      const managedStackReady =
        managedUrl !== null ? await localStack.matchesDesiredStack() : false;
      if (managedStackReady && managedUrl !== null) {
        if (await appOpener.open(managedUrl)) {
          commitPendingAppSwitch();
          destroySetupWindow();
        }
      } else {
        // Missing, stale, foreign, or owned by another process: reconcile the
        // app-managed stack before any API or computer traffic is allowed.
        void localStack.start();
        showSetupWindow();
      }
    } else {
      const reachability = await probeServer(target.url);
      if (reachability.ok) {
        if (await appOpener.open(target.url)) {
          commitPendingAppSwitch();
          destroySetupWindow();
        }
      } else {
        showSetupWindow(`Could not reconnect to the saved server. ${reachability.error}`, target.url);
      }
    }
  } else {
    if (await appOpener.open(target.url)) {
      commitPendingAppSwitch();
      destroySetupWindow();
    }
  }
  void accountComputer?.refresh();
  if(process.argv.includes("--background")){mainWindow?.hide();setupWindow?.hide();}
});

app.on("window-all-closed", () => {
  // A hidden session probe (defaultSessionHasOriginData) can be the only window
  // during startup; its teardown must not quit the app.
  if (liveProbeWindows > 0 || accountComputer?.hasConsent()) return;
  if (process.platform !== "darwin") app.quit();
});

let localShutdownComplete = false;
app.on("before-quit", (event) => {
  if (localStack instanceof LocalNativeStackController && !localShutdownComplete) {
    event.preventDefault();
    void localStack.stop().finally(() => {
      localShutdownComplete = true;
      app.quit();
    });
    return;
  }
  accountComputer?.stop();
  cloudComputer?.stop();
  quitting = true;
  clearTimeout(warmWindowTimer);
  // Containers keep running; only an in-flight pull/up is cut short.
  hostComputer?.activate(false);
  void hostComputer?.close();
  localStack?.abort();
});


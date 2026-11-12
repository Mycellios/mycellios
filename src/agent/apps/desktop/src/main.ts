import { ServerDirectory } from "./server-directory.js";
import { LocalVoice, requireVoiceModelKind } from "./local-voice.js";
import { AppBehavior } from "./app-behavior.js";
import { UpdatePreferences } from "./update-preferences.js";
import { installedFonts, validDesktopIcon } from "./appearance-settings.js";
import { installDesktopCompanions } from "./desktop-companions.js";
import { FloatingChats } from "./floating-chats.js";
import { installAccountComputerBackground } from "./account-computer-background.js";
import { installAppsStudio } from "./apps-studio-ipc.js";
import { DESKTOP_CATALOG_ALL_URL, ManualUpdateController, requireManualUpdateSpace, type ManualPackageKind } from "./manual-update.js";
import { publishedWindowsRelease } from "./published-desktop-release.js";
import { acknowledgeManualUpdate, launchManualUpdate } from "./manual-update-handoff.js";
import { linuxPackageKind } from "./linux-package.js";
import { macosPackageKind } from "./macos-package.js";
import { saveUpdateResume, restoreUpdateBinding } from "./update-resume.js";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { LocalScriptsHost, type ScriptSession } from "./local-scripts.js";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { localResourcePaths } from "./local-resource-paths.js";
import { nativeEnvironment } from "@rakazo/adapters/native-agent-process";
import type { DesktopMicoFolder, DesktopReachability, DesktopSetup } from "@rakazo/contracts";
import { videoStudioEnabled } from "@rakazo/contracts";
import type { Session } from "electron";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, Notification, powerMonitor, powerSaveBlocker, session, shell, utilityProcess } from "electron";
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
import { createSystemNotifications } from "./system-notifications.js";
import { openBrowserAuth } from "./browser-auth.js";
import { DOCKER_INSTALL_LINKS, isDesktopSetupLink, runDocker } from "./docker-cli.js";
import { computerConsentScope, prepareHostComputer } from "./host-computer.js";
import { createDesktopAgentEngine } from "@rakazo/adapters/desktop-agent-engine";
import { startDesktopExecutor } from "./executor-startup.js";
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
import { clearSetup, readPrivateFile, readSetup, writePrivateFile, writeSetup } from "./setup-store.js";
import { oauthPopupSessionPreferences, shouldOpenInAppPopup } from "./window-open.js";
import { installWindowChrome } from "./window-chrome.js";
import { installProjectBrowser } from "./project-browser.js";
import { installProjectRunner } from "./project-runner-ipc.js";
import { nativePreviewContext, nativeProjectSpace } from "./project-session.js";
import { installProjectConversations } from "./project-conversations-ipc.js";
import { assertProjectGrant, attachedRepositoryId } from "./project-grant.js";
import { isGitProjectRoot } from "./project-workspaces.js";
import {
  browserWindowOptions,
  developmentIconFile,
  setupWindowOptions,
  warmWindowTtlMs,
} from "./window-options.js";

process.setSourceMapsEnabled(true);
installDesktopEarlyErrorReporting();

const PERFORMANCE_USER_DATA = process.env.RAKAZO_PERFORMANCE_USER_DATA;
// An isolated development profile must be recognisable at a glance, so a dev
// window can never be mistaken for the production app.
if (PERFORMANCE_USER_DATA) {
  app.on("browser-window-created", (_event, window) => {
    window.on("page-title-updated", (titleEvent, title) => {
      titleEvent.preventDefault();
      window.setTitle(`${title} · dev`);
    });
  });
}
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

/** A verified package or disk image installs outside the app, so it only hands it over. */
async function openSystemInstaller(file: string): Promise<void> {
  // A mounted disk image needs no install space beyond the download already taken.
  if (process.platform !== "darwin") await requireManualUpdateSpace(app.getPath("userData"), process.execPath);
  const failure = await shell.openPath(file);
  if (failure) throw Error(failure);
}

const updaterEnvironment = {
  packaged: app.isPackaged,
  version: app.getVersion(),
  disabled: process.env.MYCELLIOS_AGENT_UPDATES_ENABLED !== "1" || process.env.RAKAZO_DISABLE_AUTO_UPDATE === "1",
};
const automaticDesktopUpdater = new DesktopUpdateController(
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
// Fedora RPM, Debian DEB and macOS disk images update from the same catalog as
// Windows; AppImages and unpackaged builds own no package and get no offer.
const catalogPackage: ManualPackageKind | null =
  process.platform === "win32" && process.arch === "x64" ? "windows-x64"
    : process.platform === "linux" && process.arch === "x64" ? linuxPackageKind(process.execPath)
      : process.platform === "darwin" ? macosPackageKind(process.arch)
        : null;
const manualDesktopUpdater = catalogPackage !== null && app.isPackaged
  ? new ManualUpdateController({
    version: app.getVersion(), directory: () => path.join(app.getPath("userData"), "updates", "manual"),
    backgroundDownloads: process.env.RAKAZO_DISABLE_AUTO_UPDATE !== "1",
    autoDownload: () => updatePreferences?.preferences().autoDownload ?? true,
    ...(catalogPackage === "windows-x64"
      ? { publishedRelease: () => publishedWindowsRelease(app.getVersion()) }
      : { packageKind: catalogPackage, catalogUrl: DESKTOP_CATALOG_ALL_URL, installAction: "system-installer" as const }),
    busy: () => Boolean(hostComputer?.hasActiveWork() || cloudComputer?.busy() || accountComputer?.busy()),
    prepare: prepareRendererUpdate,
    handoff: catalogPackage !== "windows-x64" ? file => openSystemInstaller(file) : async (file, release) => {
      const profile = app.getPath("userData");
      await requireManualUpdateSpace(profile, process.execPath);
      const win = mainWindow;
      if (!win || win.isDestroyed()) throw Error("The app window changed");
      const reopen = new URL(win.webContents.getURL());
      reopen.search = "";
      reopen.hash = "";
      win.setEnabled(false);
      try {
        await win.webContents.session.cookies.flushStore();
        await win.webContents.session.flushStorageData();
        await accountComputer?.freezeForUpdate();
        await saveUpdateResume(app.getPath("userData"), app.getVersion(), release.version,
          [...(accountComputer?.resumeBindings() ?? []), ...(cloudComputer?.resumeBindings() ?? [])]);
        await Promise.all([accountComputer?.beginUpdate(), cloudComputer?.beginUpdate()]);
        await hostComputer?.prepareUpdate();
        accountComputer?.stop();
        cloudComputer?.stop();
        hostComputer?.activate(false);
        await launchManualUpdate({ profile, executable: process.execPath,
          oldPid: process.pid, installer: file, release, reopenUrl: reopen.href });
        quitting = true;
        app.quit();
      } catch (error) {
        if (!win.isDestroyed()) win.setEnabled(true);
        hostComputer?.cancelUpdate();
        cloudComputer?.cancelUpdate();
        accountComputer?.cancelUpdate();
        accountComputer?.start();
        throw error;
      }
    },
  }) : null;
const desktopUpdater = manualDesktopUpdater ?? automaticDesktopUpdater;
let updatePreferences: UpdatePreferences | undefined;
let serverDirectory: ServerDirectory;
let preferredServer: string | null = null;
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
/**
 * OpenBot's model: closing the window quits, unless the user explicitly chose to
 * keep the app running in the background. The preference is native and local.
 */
let keepRunningInBackground = false;
let appBehavior: AppBehavior | undefined;
let desktopCompanions: Awaited<ReturnType<typeof installDesktopCompanions>> | undefined;
let floatingChats: FloatingChats | undefined;
let reopenRetainedConnection: (() => void) | undefined;

async function loadBackgroundPreference(profile: string) {
  appBehavior = new AppBehavior({
    packaged: app.isPackaged, platform: process.platform,
    read: () => readPrivateFile(path.join(profile, "app-behavior.json"), 4096).catch(() => null),
    write: raw => writePrivateFile(path.join(profile, "app-behavior.json"), raw),
    login: { get: () => app.getLoginItemSettings().openAtLogin,
      set: openAtLogin => app.setLoginItemSettings({ openAtLogin }) },
    power: { onBattery: () => powerMonitor.isOnBatteryPower(),
      start: () => powerSaveBlocker.start("prevent-app-suspension"), stop: id => powerSaveBlocker.stop(id) },
    changed: value => { keepRunningInBackground = value.keepRunningInBackground; installApplicationMenu(); },
  });
  await appBehavior.load();
  powerMonitor.on("on-ac", () => appBehavior?.syncPower());
  powerMonitor.on("on-battery", () => appBehavior?.syncPower());
}

function setKeepRunningInBackground(checked: boolean) {
  void appBehavior?.update({ keepRunningInBackground: checked }).catch(error => reportDesktopError(error, "desktop.settings"));
}

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

function fromUpdateWindow(event: Electron.IpcMainInvokeEvent) {
  return fromMainWindow(event) && event.senderFrame === event.sender.mainFrame;
}

function openExternalLink(url: string) {
  if (appBehavior?.state().externalLinkTarget !== "app" || !/^https?:/.test(url)) {
    void shell.openExternal(url).catch(error => reportDesktopError(error, "desktop.externalLink"));
    return;
  }
  // An external page never inherits our preload, native bridge or server cookies.
  const browser = new BrowserWindow({ width: 1100, height: 780, title: url,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: "external-links" } });
  browser.webContents.setWindowOpenHandler(({ url: target }) => {
    const safe = safeExternalUrl(target);
    if (safe) openExternalLink(safe);
    return { action: "deny" };
  });
  browser.webContents.on("will-navigate", (event, target) => {
    if (!/^https?:/.test(target)) { event.preventDefault(); const safe = safeExternalUrl(target); if (safe) void shell.openExternal(safe); }
  });
  void browser.loadURL(url).catch(error => reportDesktopError(error, "desktop.externalLink"));
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
  accountComputer?.start();
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
    if (external !== null) openExternalLink(external);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, navigationUrl) => {
    if (targetOrigin !== null && safeOrigin(navigationUrl) === targetOrigin) return;
    event.preventDefault();
    const external = safeExternalUrl(navigationUrl);
    if (external !== null) openExternalLink(external);
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
    if (!quitting && (keepRunningInBackground || (floatingChats?.liveWindows().length ?? 0) > 0)) {
      event.preventDefault(); win.hide(); return;
    }
    desktopCompanions?.clear();
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
    const check = () => { if (!quitting) void desktopUpdater.check(false); };
    setTimeout(check, LAUNCH_CHECK_DELAY_MS).unref();
    setInterval(check, 4 * 60 * 1_000).unref();
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
  let mainStatus: number | undefined;
  // Session webRequest listeners are singletons. Floating chats share the
  // session, so observe this window's navigation without replacing another load.
  const onNavigate = (_event: Electron.Event, _url: string, status: number) => { mainStatus = status; };
  contents.on("did-navigate", onNavigate);

  return new Promise<AppDocumentState>((resolve, reject) => {
    let settled = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      contents.removeListener("did-fail-load", onFail);
      // Keep render-process-gone until document readiness finishes so a crash
      // during mount still fails the switch.
      contents.removeListener("did-navigate", onNavigate);
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
      () => settle(),
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
  const alert = (options: Electron.MessageBoxOptions) =>
    mainWindow && !mainWindow.isDestroyed()
      ? dialog.showMessageBox(mainWindow, options)
      : dialog.showMessageBox(options);
  if (state.phase === "available") {
    const { response } = await alert({
      message: `Mycellios ${state.availableVersion} is available.`, buttons: ["Download", "Later"],
      defaultId: 0, cancelId: 1, noLink: true,
    });
    if (response !== 0) return;
    state = await desktopUpdater.download();
  } else if (state.phase === "downloading") {
    state = await desktopUpdater.download();
  }
  if (state.phase === "ready") {
    const { response } = await alert({
      message: `Mycellios ${state.availableVersion} is ready to install.`,
      buttons: ["Restart", "Later"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return;
    const result = await installUpdate();
    if (result.message && !result.installPending) {
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
    await alert({ message: "Mycellios is up to date.", detail: `Version ${state.currentVersion}` });
  }
}

async function installUpdate(force = false) {
  if (manualDesktopUpdater) return manualDesktopUpdater.install(force);
  if (desktopUpdater.state().phase !== "ready") return desktopUpdater.state();
  if (hostComputer?.hasActiveWork() || cloudComputer?.busy() || accountComputer?.busy()) return {
    ...desktopUpdater.state(), message: "A local task is still running. Install the update when it finishes.",
  };
  if (!await prepareRendererUpdate()) return { ...desktopUpdater.state(), message: "Save changes or finish the call to restart." };
  quitting = true;
  const state = await desktopUpdater.install();
  // A failed install stays ready for retry but reports a message. Restore normal
  // window behavior while the user keeps working after that failure.
  if (state.phase !== "ready" || state.message !== null) quitting = false;
  return state;
}

/** Exact current main-frame acknowledgement; a missing/old renderer never permits a quit. */
async function prepareRendererUpdate(): Promise<boolean> {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return false;
  const windows = [win, ...(floatingChats?.liveWindows() ?? [])];
  const prepared = await Promise.all(windows.map(window => prepareWindowUpdate(window)));
  return mainWindow === win && prepared.every(Boolean);
}

async function prepareWindowUpdate(win: BrowserWindow): Promise<boolean> {
  const contents = win.webContents, url = contents.getURL(), nonce = randomBytes(16).toString("hex");
  return new Promise(resolve => {
    const finish = (ready: boolean) => {
      clearTimeout(timer);
      ipcMain.off("desktop.update.prepared", received);
      resolve(ready && !win.isDestroyed() && contents.getURL() === url);
    };
    const received = (event: Electron.IpcMainEvent, value: unknown) => {
      if (event.sender !== contents || event.senderFrame !== contents.mainFrame ||
          !value || typeof value !== "object" || !("nonce" in value) || value.nonce !== nonce) return;
      finish("ready" in value && value.ready === true);
    };
    const timer = setTimeout(() => finish(false), 2_000);
    ipcMain.on("desktop.update.prepared", received);
    contents.send("desktop.update.prepare", nonce);
  });
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
    visible: manualDesktopUpdater !== null || updaterSupport(updaterEnvironment).supported,
    click: () => void checkForUpdatesFromMenu(),
  };
  const keepRunningBackground: Electron.MenuItemConstructorOptions = {
    type: "checkbox",
    checked: keepRunningInBackground,
    label: "Keep Running in the Background",
    click: (item) => setKeepRunningInBackground(item.checked),
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
              keepRunningBackground,
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

/** Setup IPC must only answer the setup window, never a connected Mycellios server. */
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
        error: "That address redirects elsewhere. Enter the final Mycellios server address.",
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
        error: "That address did not respond like a Mycellios server.",
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
    const loaded = await created.loaded;
    if (loaded === "failed" && switching) {
      throw new Error("The server page did not become ready.");
    }
    if (loaded !== "failed" && manualDesktopUpdater) {
      void acknowledgeManualUpdate(app.getPath("userData"), process.execPath, app.getVersion(), process.pid, process.argv)
        .catch(() => console.warn("Could not record Desktop update startup"));
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
    if (win === null) { reopenRetainedConnection?.(); return; }
    revealSecondInstanceWindow(win);
  });
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  if (process.platform === "win32") app.setAppUserModelId("com.mycellios.agent.desktop");
  installSessionPermissions(session.defaultSession, permissionTarget);
  const userDataDir = app.getPath("userData");
  await loadBackgroundPreference(userDataDir);
  serverDirectory = new ServerDirectory({
    read: () => readPrivateFile(path.join(userDataDir, "servers.json"), 65536),
    write: raw => writePrivateFile(path.join(userDataDir, "servers.json"), raw),
  });
  await serverDirectory.load();
  ipcMain.handle("desktop.servers.list", event => {
    if (!fromUpdateWindow(event)) throw new Error("Servers require the main app window");
    return { servers: serverDirectory.list(), current: currentTargetUrl };
  });
  ipcMain.handle("desktop.servers.manage", async (event, selected: unknown) => {
    if (!fromUpdateWindow(event)) throw new Error("Servers require the main app window");
    if (hostComputer?.hasActiveWork() || cloudComputer?.busy() || accountComputer?.busy()) throw new Error("Finish active work before changing servers");
    if (!await prepareRendererUpdate()) throw new Error("Save drafts and finish calls before changing servers");
    if (selected !== undefined && (typeof selected !== "string" || !serverDirectory.list().some(entry => entry.serverUrl === selected))) throw new Error("Unknown server");
    preferredServer = typeof selected === "string" ? selected : null;
    showSetupWindow();
  });
  ipcMain.handle("desktop.setup.servers", event => {
    if (!fromSetupWindow(event)) throw new Error("Setup is not active");
    return serverDirectory.list();
  });
  ipcMain.handle("desktop.setup.forgetServer", async (event, url: unknown) => {
    if (!fromSetupWindow(event) || typeof url !== "string" || setupSaveInProgress) throw new Error("Setup is busy");
    if (normalizeServerUrl(url) === normalizeServerUrl(currentTargetUrl ?? "")) throw new Error("Cannot forget the current server");
    await serverDirectory.remove(url); return serverDirectory.list();
  });

  updatePreferences = new UpdatePreferences({
    packaged: app.isPackaged,
    allowed: process.env.RAKAZO_DISABLE_AUTO_UPDATE !== "1" && Boolean(manualDesktopUpdater || updaterSupport(updaterEnvironment).supported),
    // Only a same-user Windows handoff installs unattended; a package manager needs the owner.
    installSupported: process.platform === "win32",
    read: () => readPrivateFile(path.join(userDataDir, "update-preferences.json"), 4096).catch(() => null),
    write: raw => writePrivateFile(path.join(userDataDir, "update-preferences.json"), raw),
    state: () => desktopUpdater.state(), download: () => desktopUpdater.download(), install: () => installUpdate(),
    cancelInstall: () => manualDesktopUpdater?.cancelInstall() ?? Promise.resolve(desktopUpdater.state()),
    busy: () => Boolean(hostComputer?.hasActiveWork() || cloudComputer?.busy() || accountComputer?.busy()),
    prepare: prepareRendererUpdate,
    relaunch: async () => {
      const win = mainWindow; if (!win || win.isDestroyed()) throw new Error("The app window changed");
      try {
        await win.webContents.session.cookies.flushStore(); await win.webContents.session.flushStorageData();
        await accountComputer?.freezeForUpdate();
        await Promise.all([accountComputer?.beginUpdate(), cloudComputer?.beginUpdate()]);
        await hostComputer?.prepareUpdate();
        app.relaunch(); quitting = true; app.quit();
      } catch (error) {
        hostComputer?.cancelUpdate(); cloudComputer?.cancelUpdate(); accountComputer?.cancelUpdate(); accountComputer?.start(); throw error;
      }
    },
  });
  await updatePreferences.load();
  const updatePolicyTimer = setInterval(() => { if (!quitting) void updatePreferences?.tick(); }, 2_000);
  updatePolicyTimer.unref(); app.once("before-quit", () => clearInterval(updatePolicyTimer));
  const revealChat = (target: { scope: string; botId: string; respond?: boolean }) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      revealSecondInstanceWindow(mainWindow);
      mainWindow.webContents.send("desktop.companions.select", target);
  };
  floatingChats = new FloatingChats({
    main: () => mainWindow,
    load: loadAppUrl,
    external: destination => {
      const safe = safeExternalUrl(destination);
      if (safe) openExternalLink(safe);
    },
    reveal: revealChat,
    onEmpty: () => {
      if (!quitting && !keepRunningInBackground && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        revealSecondInstanceWindow(mainWindow);
      }
    },
  });
  ipcMain.handle("desktop.chat.return", event => floatingChats!.returnToMain(event.sender, event.senderFrame));
  desktopCompanions = await installDesktopCompanions({
    mainWindow: () => mainWindow,
    profile: userDataDir, allowed: fromUpdateWindow, reveal: revealChat,
    requestReply: request => {
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error("The app is unavailable");
      mainWindow.webContents.send("desktop.companions.question", request);
    },
    openChat: target => floatingChats!.open(target),
    scopeChanged: scope => floatingChats!.account(scope),
  });
  ipcMain.handle("desktop.settings.state", event => {
    if (!fromUpdateWindow(event)) throw new Error("Settings require the main app window");
    return appBehavior!.state();
  });
  ipcMain.handle("desktop.settings.fonts", event => {
    if (!fromUpdateWindow(event)) throw new Error("Settings require the main app window");
    return installedFonts(process.platform);
  });
  ipcMain.handle("desktop.settings.logo", (event, png: unknown) => {
    if (!fromUpdateWindow(event) || !validDesktopIcon(png)) throw new Error("Invalid app icon");
    const image = png === null ? nativeImage.createFromPath(path.join(import.meta.dirname, "assets", process.platform === "darwin" ? "icon-macos.png" : "icon.png")) : nativeImage.createFromDataURL(png);
    if (image.isEmpty()) throw new Error("Invalid app icon");
    mainWindow?.setIcon(image); app.dock?.setIcon(image);
  });
  ipcMain.handle("desktop.settings.update", (event, patch: unknown) => {
    if (!fromUpdateWindow(event)) throw new Error("Settings require the main app window");
    return appBehavior!.update(patch);
  });
  contributionRuntime = new ContributionRuntime({
    platform: process.platform,
    resources: process.resourcesPath,
    userData: userDataDir,
    programFiles: process.env.ProgramFiles ?? "C:\\Program Files",
    programData: process.env.ProgramData ?? "C:\\ProgramData",
  });
  const agentEngine = createDesktopAgentEngine(userDataDir, () => hostComputer?.executionScope());
  for (;;) {
    try { hostComputer = await startDesktopExecutor(() => prepareHostComputer(userDataDir, agentEngine), {
      // A development launcher may have exited and closed stderr. Report through
      // the desktop reporter so a diagnostic cannot itself throw EPIPE.
      report: code => reportDesktopError(new Error(`Desktop executor startup failed (${code})`), "desktop.startup"),
    }); break; }
    catch {
      // Do not open a working-looking chat with no native executor and swallow its cause.
      const result = await dialog.showMessageBox({ type: "error", title: "Mycellios", message: "The PC executor could not start.", detail: "Retry to start local execution.", buttons: ["Retry", "Close"], defaultId: 0, cancelId: 1, noLink: true });
      if (result.response !== 0) { app.quit(); return; }
    }
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
  const nativeResources = localResourcePaths(nativeRoot);
  // Existing Compose installations retain their database, ports, and service lifecycle.
  if (
    !existsSync(path.join(stackDir(userDataDir), ".env")) &&
    existsSync(nativeResources.entry)
  ) {
    localStack = new LocalNativeStackController({
      dataDir: path.join(userDataDir, "local-data"),
      stackDir: stackDir(userDataDir),
      webRoot: app.isPackaged
        ? path.join(process.resourcesPath, "web")
        : path.resolve(app.getAppPath(), "../web/dist"),
      migrationsRoot: nativeResources.migrationsRoot,
      localWebUrl: await readStackWebUrl(stackDir(userDataDir), LOCAL_WEB_URL),
      build: app.getVersion(),
      hostComputer: hostComputer?.connection,
      launch: (configFile) =>
        utilityProcess.fork(nativeResources.entry, [], {
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
  const knownTarget = normalizeServerUrl(process.env.RAKAZO_WEB_URL ?? currentSetup?.serverUrl ?? "");
  if (knownTarget) await serverDirectory.remember({mode: currentSetup?.serverUrl === knownTarget ? currentSetup.mode : "existing", serverUrl: knownTarget}).catch(() => {});
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
  if (videoStudioEnabled(process.env.MYCELLIOS_VIDEO_STUDIO)) installAppsStudio({ userData: userDataDir, context: async event => {
    const captured = mainWindow;
    if (!captured || !fromMainWindow(event) || event.senderFrame !== event.sender.mainFrame || !hostComputer?.isEnabled() || !isCloudComputerRequest(event)) throw new Error("Apps necesita el acceso ya autorizado a este PC y tu sesión de Mycellios.");
    const identity = await getCloudComputer().identity();
    const space = await nativeProjectSpace(captured) ?? identity.spaceId;
    const server = projectServer();
    if (!server || !space || JSON.stringify(identity) !== cloudComputerOwner || mainWindow !== captured || captured.isDestroyed() || event.senderFrame?.url !== captured.webContents.getURL() || !hostComputer.isEnabled()) throw new Error("La cuenta o el Space han cambiado. Reconecta el PC desde Mycellios.");
    return { owner: identity.userId, space, server };
  },videoRequest:async(event,scope,action,payload)=>{
    const window=mainWindow;
    if(!window||!fromMainWindow(event)||event.senderFrame!==event.sender.mainFrame||projectServer()!==scope.server||!hostComputer?.isEnabled())throw new Error("La sesión del editor ha cambiado.");
    const before=await nativePreviewContext(window);
    if(before[0]!==scope.owner||before[1]!==scope.space)throw new Error("La cuenta o el espacio han cambiado.");
    const response=await window.webContents.session.fetch(`${scope.server}/rpc/models/mycelliosVideoEdit`,{
      method:"POST",credentials:"include",redirect:"error",bypassCustomProtocolHandlers:true,signal:AbortSignal.timeout(180000),
      headers:{"content-type":"application/json",origin:new URL(scope.server).origin,"x-rakazo-space-id":scope.space},
      body:JSON.stringify({json:{action,payload:JSON.stringify(payload)}}),
    });
    if(!response.ok){await response.body?.cancel();throw new Error("No se pudo conectar el editor al monedero Mycellios. El trabajo no se reenviará.");}
    const {bounded}=await import("./video-edit-provider.js");
    const value=JSON.parse(Buffer.from(await bounded(response,100_000_000)).toString("utf8"));
    if(mainWindow!==window||window.isDestroyed()||projectServer()!==scope.server||!hostComputer?.isEnabled()
      ||event.senderFrame?.url!==window.webContents.getURL()||JSON.stringify(await nativePreviewContext(window))!==JSON.stringify(before))throw new Error("La sesión del editor ha cambiado.");
    if(!("json" in value))throw new Error("Respuesta del monedero no válida.");return value.json;
  } });
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
  const scriptFile = (kind: "config" | "quota") => path.join(userDataDir, `local-scripts-${kind}.json`);
  const scriptSession = async (): Promise<ScriptSession | null> => {
    const window = mainWindow, server = projectServer();
    if (!window || window.isDestroyed() || !server) return null;
    const url = window.webContents.getURL(), session = window.webContents.session;
    const [owner, space] = await nativePreviewContext(window);
    if (!owner || !space) return null;
    const valid = async () => mainWindow === window && !window.isDestroyed() && projectServer() === server &&
      window.webContents.getURL() === url && JSON.stringify(await nativePreviewContext(window)) === JSON.stringify([owner, space]);
    return { binding: { server, owner, space }, valid, rpc: async (method, input) => {
      if (!await valid()) throw new Error("The application session changed.");
      const allowed = new Set(["preferences/micos", "routines/list", "routines/testRun", "threads/get", "threads/send", "threads/answer"]);
      if (!allowed.has(method)) throw new Error("Unsupported local script action");
      const response = await session.fetch(`${server}/rpc/${method}`, {
        method: "POST", credentials: "include", redirect: "error", bypassCustomProtocolHandlers: true,
        headers: { "content-type": "application/json", origin: new URL(server).origin, "x-rakazo-space-id": space },
        body: JSON.stringify({ json: input }), signal: AbortSignal.timeout(15000),
      });
      if (!response.ok || !await valid()) throw new Error("Local script action was refused by the current session.");
      const body = await response.json() as { json?: unknown }; return body.json;
    } };
  };
  const localScripts = new LocalScriptsHost({ configPath: scriptFile("config"), session: scriptSession,
    read: async kind => {
      const raw = await readPrivateFile(scriptFile(kind), 1024 * 1024);
      if (raw === null && existsSync(scriptFile(kind))) throw new Error("Invalid local script profile");
      return raw;
    },
    write: (kind, raw) => writePrivateFile(scriptFile(kind), raw) });
  let localScriptsReady = false;
  try { await localScripts.start(); localScriptsReady = true; }
  catch { await localScripts.close(); console.error("Local scripts could not start; automation remains disabled."); }
  app.once("before-quit", () => { void localScripts.close(); });
  ipcMain.handle("desktop.localScripts.state", event => {
    if (!fromUpdateWindow(event) || !localScriptsReady) throw new Error("Local scripts require the main app window.");
    return localScripts.state();
  });
  ipcMain.handle("desktop.localScripts.configure", (event, patch: unknown) => {
    if (!fromUpdateWindow(event) || !localScriptsReady) throw new Error("Local scripts require the main app window.");
    return localScripts.configure(patch);
  });
  const isCloudComputerRequest = (event: Electron.IpcMainInvokeEvent) => {
    const server = projectServer();
    if (!server || currentSetup?.mode === "new" || !fromMainWindow(event) || event.senderFrame !== event.sender.mainFrame) return false;
    const base = new URL(server), page = new URL(event.senderFrame.url);
    const prefix = base.pathname.replace(/\/$/, "");
    return page.origin === base.origin && (page.pathname === prefix || page.pathname.startsWith(prefix + "/"));
  };
  const localVoice = new LocalVoice(
    path.join(app.getPath("userData"), "voice-models"),
    path.join(app.getAppPath(), "dist", process.platform === "win32" ? "voice-node.exe" : "voice-node"),
  );
  const voiceWindows = new Set<number>();
  const voiceOwner = (event: Electron.IpcMainInvokeEvent) => {
    if (!isCloudComputerRequest(event) && !isManagedComputerRequest(event)) throw new Error("Untrusted voice caller");
    const win = windowFrom(event)!;
    const owner = win.id;
    if (!voiceWindows.has(owner)) {
      voiceWindows.add(owner);
      win.once("closed", () => { void localVoice.stop(owner); voiceWindows.delete(owner); });
    }
    return owner;
  };
  ipcMain.handle("desktop.localVoice.status", event => {
    voiceOwner(event);
    return localVoice.statusFromDisk();
  });
  ipcMain.handle("desktop.localVoice.prepare", event => {
    voiceOwner(event);
    return localVoice.prepare();
  });
  ipcMain.handle("desktop.localVoice.prepareModel", (event, kind: unknown) => {
    voiceOwner(event);
    return localVoice.prepareModel(requireVoiceModelKind(kind));
  });
  ipcMain.handle("desktop.localVoice.removeModel", (event, kind: unknown) => {
    voiceOwner(event);
    return localVoice.removeModel(requireVoiceModelKind(kind));
  });
  ipcMain.handle("desktop.localVoice.transcribe", (event, samples: Float32Array) => localVoice.run(voiceOwner(event), { samples }));
  ipcMain.handle("desktop.localVoice.speak", (event, input: { text: string; language: string; speed: number }) => {
    if (!input || typeof input.language !== "string" || !/^[a-z]{2}$/.test(input.language) || !Number.isFinite(input.speed)) throw new Error("Invalid voice input");
    return localVoice.run(voiceOwner(event), { text: input.text, language: input.language, speed: input.speed });
  });
  ipcMain.handle("desktop.localVoice.stop", event => localVoice.stop(voiceOwner(event)));
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
        restoreUpdate: (identity, botId) => restoreUpdateBinding(userDataDir, app.getVersion(), base, identity, botId),
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
    agentExecution: 1,
    profile:userDataDir,host:hostComputer,nativeVersion:app.getVersion(),
    localUrl:hostComputer.connection.url.replace("host.docker.internal","127.0.0.1"),localToken:hostComputer.connection.token,
    consentScope:computerConsentScope,window:()=>mainWindow,changed:installApplicationMenu,
    keepRunningInBackground:()=>keepRunningInBackground,
    manageLoginPreference:false,
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
  const attachedFolders = new Map<string, { scope: string; folder: DesktopMicoFolder }>();
  async function micoFolderScope(event: Electron.IpcMainInvokeEvent, botId: string) {
    const managed = isManagedComputerRequest(event);
    const window = mainWindow, base = projectServer();
    if (!window || !base || (!managed && !isCloudComputerRequest(event)) || !hostComputer?.isEnabled())
      throw new Error("Allow local computer access first.");
    const url = event.senderFrame!.url;
    const [owner, spaceId] = await nativePreviewContext(window);
    const response = await window.webContents.session.fetch(`${base}/rpc/bots/get`, {
      method: "POST", credentials: "include", redirect: "error", bypassCustomProtocolHandlers: true,
      headers: { "content-type": "application/json", origin: new URL(base).origin,
        ...(spaceId ? { "x-rakazo-space-id": spaceId } : {}) },
      body: JSON.stringify({ json: { botId } }), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Open this Mico in its Space first.");
    const { json: bot } = await response.json() as { json?: { id?: string; spaceId?: string } };
    const identity = managed ? null : await getCloudComputer().identity();
    if (!owner || bot?.id !== botId || !bot.spaceId ||
      (identity && (JSON.stringify(identity) !== cloudComputerOwner || identity.userId !== owner || identity.spaceId !== bot.spaceId)) ||
      (managed && !await localStack.matchesDesiredStack()) ||
      mainWindow !== window || window.isDestroyed() || projectServer() !== base || !hostComputer.isEnabled() ||
      window.webContents.getURL() !== url || JSON.stringify(await nativePreviewContext(window)) !== JSON.stringify([owner, spaceId]))
      throw new Error("The application session changed.");
    return JSON.stringify([base, owner, bot.spaceId]);
  }
  ipcMain.handle("desktop.computer.project", async (event, botId: unknown) => {
    if ((!isManagedComputerRequest(event) && !isCloudComputerRequest(event)) || !hostComputer?.isEnabled() ||
      typeof botId !== "string" || !/^[a-zA-Z0-9_-]{1,256}$/.test(botId))
      return null;
    const project = hostComputer.project(botId);
    if (!project) return null;
    const scope = await micoFolderScope(event, botId);
    const attached = attachedFolders.get(botId);
    return attached?.scope === scope && attached.folder.path === project.path ? attached.folder : project;
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
    if (typeof botId !== "string" || !/^[a-zA-Z0-9_-]{1,256}$/.test(botId) || !hostComputer)
      throw new Error("Invalid agent.");
    const url = event.senderFrame?.url;
    const scope = await micoFolderScope(event, botId);
    const selected = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory", "createDirectory"] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const folder = await realpath(selected.filePaths[0]);
    const repositoryId = await isGitProjectRoot(folder)
      ? attachedRepositoryId(hostComputer.connection.token, scope, botId, folder) : undefined;
    if (isCloudComputerRequest(event)) await connectLocalComputer(botId);
    if (event.senderFrame?.url !== url || await micoFolderScope(event, botId) !== scope)
      throw new Error("The folder account changed.");
    if (isCloudComputerRequest(event)) assertProjectGrant(hostComputer.project(botId), folder);
    const project = { ...await hostComputer.selectProject(botId, folder), repositoryId };
    attachedFolders.set(botId, { scope, folder: project });
    return project;
  });
  if (hostComputer) projectConversations = installProjectConversations({
    storage: path.join(userDataDir, "project-conversations"), host: hostComputer,
    attachedRepository: (scope, botId, projectId) => {
      const attached = attachedFolders.get(botId);
      if (attached?.scope === scope && attached.folder.repositoryId === projectId &&
        hostComputer?.project(botId)?.path === attached.folder.path) return attached.folder.path;
    },
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
      attachedFolders.clear();
      cloudComputerOwner = undefined; const revoked=hostComputer?.revoke(); await accountComputer?.revoke(); await cloudComputer?.revoke(); await revoked; installApplicationMenu(); return;
    }
    if (isManagedComputerRequest(event)) {
      attachedFolders.clear();
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
  const notifications = createSystemNotifications({
    getTarget: permissionTarget, platform: process.platform, supported: () => Notification.isSupported(),
    create: ({ title, body, silent }) => new Notification({ title, body, silent,
      icon: path.join(app.getAppPath(), "assets", "icon.png") }),
    openSettings: (url) => shell.openExternal(url),
    focus: (contents) => { const win = BrowserWindow.fromWebContents(contents); if (win?.isMinimized()) win.restore(); win?.show(); win?.focus(); },
  });
  ipcMain.handle("desktop.notifications.status", event => notifications.status(event));
  ipcMain.handle("desktop.notifications.clear", event => notifications.clear(event));
  ipcMain.handle("desktop.notifications.settings", event => notifications.openSettings(event));
  ipcMain.handle("desktop.notifications.show", (event, input) => notifications.show(event, input));
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
  ipcMain.handle("desktop.update.state", event => fromUpdateWindow(event) ? updatePreferences!.state() : desktopUpdater.state());
  ipcMain.handle("desktop.update.preferences", event => {
    if (!fromUpdateWindow(event)) throw new Error("Update settings require the main app window");
    return updatePreferences!.preferences();
  });
  ipcMain.handle("desktop.update.savePreferences", (event, patch: unknown) => {
    if (!fromUpdateWindow(event)) throw new Error("Update settings require the main app window");
    return updatePreferences!.save(patch);
  });
  ipcMain.handle("desktop.update.restartWhenIdle", event => {
    if (!fromUpdateWindow(event)) throw new Error("Restart requires the main app window");
    return updatePreferences!.request(desktopUpdater.state().phase === "ready" ? "update" : "relaunch");
  });
  ipcMain.handle("desktop.update.cancelRestart", event => {
    if (!fromUpdateWindow(event)) throw new Error("Restart requires the main app window");
    return updatePreferences!.cancel();
  });
  ipcMain.handle("desktop.update.cancelInstall", (event) =>
    fromUpdateWindow(event) && manualDesktopUpdater ? manualDesktopUpdater.cancelInstall() : desktopUpdater.state(),
  );
  ipcMain.handle("desktop.update.check", (event) =>
    fromUpdateWindow(event) ? desktopUpdater.check(true) : desktopUpdater.state(),
  );
  ipcMain.handle("desktop.update.download", (event) =>
    fromUpdateWindow(event) ? desktopUpdater.download() : desktopUpdater.state(),
  );
  ipcMain.handle("desktop.update.forceInstall", (event) =>
    fromUpdateWindow(event) && manualDesktopUpdater ? installUpdate(true) : desktopUpdater.state(),
  );
  ipcMain.handle("desktop.update.install", (event) =>
    fromUpdateWindow(event) ? updatePreferences!.request("update") : desktopUpdater.state(),
  );
  ipcMain.handle("desktop.setup.state", (event) => {
    if (!fromSetupWindow(event)) return null;
    return {
      manager: currentTargetUrl !== null,
      preferredServer,
      activeServer: currentTargetUrl,
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
    if (currentTargetUrl && (hostComputer?.hasActiveWork() || cloudComputer?.busy() || accountComputer?.busy()))
      return { ok: false, error: "Termina las tareas activas antes de cambiar de servidor." };
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
            error: "The app-managed Mycellios services are not ready. Retry setup.",
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
        await serverDirectory.remember(openSetup, typeof payload === "object" && payload !== null && "name" in payload && typeof payload.name === "string" ? payload.name : undefined).catch(() => console.warn("Could not save server directory"));
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
  reopenRetainedConnection = () => {
    if (currentTargetUrl) void appOpener.open(currentTargetUrl).then(opened => { if (opened) commitPendingAppSwitch(); });
    else showSetupWindow();
  };
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
  // during startup; its teardown must not quit the app. A hidden main window is
  // still a window, so "keep running in the background" does not reach here.
  if (liveProbeWindows > 0) return;
  // Only an already authorized, live remote transport may outlive its window.
  // Explicit Quit still runs the normal shutdown and stops every transport.
  if (appBehavior?.state().keepRemoteSessions && accountComputer?.hasConsent() && accountComputer.online()) return;
  if (process.platform !== "darwin") app.quit();
  else accountComputer?.stop();
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
  appBehavior?.dispose();
  desktopCompanions?.dispose();
  floatingChats?.clear();
  cloudComputer?.stop();
  quitting = true;
  clearTimeout(warmWindowTimer);
  // Containers keep running; only an in-flight pull/up is cut short.
  hostComputer?.activate(false);
  void hostComputer?.close();
  localStack?.abort();
});


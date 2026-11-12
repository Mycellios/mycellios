import type { DesktopRuntimeBridge } from "../../../../contracts/desktop-runtime.js";
import type { DesktopQuestionRequest, DesktopQuestionResult, DesktopCompanionPreferences, DesktopCompanionSnapshot } from "./desktop-companions.js";
export * from "./desktop-companions.js";
import type { ProjectRunnerBridge } from "../../../../contracts/project-runner.js";
export type { ProjectRunState, ProjectRunConfig, ProjectRunnerBridge } from "../../../../contracts/project-runner.js";

export type DesktopMicoFolder = { name: string; path: string; repositoryId?: string };

export type LocalVoiceModelKind = "asr" | "tts";
export interface LocalVoiceModelStatus {
  ready: boolean;
  preparing: boolean;
  downloaded: number;
  total: number;
  error?: string;
}
export interface LocalVoiceStatus extends LocalVoiceModelStatus {
  models?: Record<LocalVoiceModelKind, LocalVoiceModelStatus>;
}

/**
 * `unsupported` covers an unpackaged build and a repository with no published releases, which is
 * the normal state for a fork. It is not an error the user needs to act on. Automatic checks stay
 * frozen after an empty feed; a manual check may retry when the install itself supports updates.
 */
export type DesktopUpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "unsupported"
  | "error";

export interface DesktopUpdateState {
  relaunchPending?: boolean;
  relaunchWaitingFor?: "local_work" | "unsaved_work" | "update_download";
  relaunchError?: boolean;
  autoInstallEnabled?: boolean;
  /** Grace period for an automatic idle restart; absent during explicit restarts. */
  automaticRestartAt?: number;
  phase: DesktopUpdatePhase;
  /** The installed desktop release, which can drift from the server this app points at. */
  currentVersion: string;
  availableVersion: string | null;
  /** Download progress 0-100, only while `downloading`. */
  percent: number | null;
  message: string | null;
  checkedAt: string | null;
  /** A user-requested restart waits without cancelling active or unsaved work. */
  installPending?: boolean;
  /** A verified package is applied inside the app or handed to the system installer. */
  installAction?: "restart" | "system-installer";
  /** The verified package was handed to the system installer; the owner restarts after it runs. */
  handoffComplete?: boolean;
  supportsForceRestart?: boolean;
  restartMode?: "whenIdle" | "now";
  waitingFor?: "local_work" | "unsaved_work";
}

export interface RakazoDesktopUpdate {
  preferences?: () => Promise<DesktopUpdatePreferences>;
  savePreferences?: (patch: { autoDownload?: boolean; autoInstall?: boolean }) => Promise<DesktopUpdatePreferences>;
  restartWhenIdle?: () => Promise<DesktopUpdateState>;
  cancelRestart?: () => Promise<DesktopUpdateState>;
  state: () => Promise<DesktopUpdateState>;
  check: () => Promise<DesktopUpdateState>;
  download: () => Promise<DesktopUpdateState>;
  /** Quits and relaunches into the downloaded release; only useful once `phase` is `ready`. */
  install: () => Promise<DesktopUpdateState>;
  cancelInstall?: () => Promise<DesktopUpdateState>;
  /** Explicitly checkpoint local operations; renderer persistence still must succeed. */
  forceInstall?: () => Promise<DesktopUpdateState>;
  /** Native request to verify renderer work is persisted before its normal quit. */
  onPrepare?: (listener: () => boolean | Promise<boolean>) => () => void;
}

export interface DesktopUpdatePreferences {
  channel: "stable" | "development";
  supported: boolean;
  autoDownload: boolean;
  autoInstall: boolean;
  /** Unattended installation stays off where the package manager applies the update. */
  installSupported?: boolean;
}

export interface RakazoDesktopOAuthCallback {
  code: string;
  state?: string;
}

export interface RakazoDesktop {
  /** Chat-only window. Native settings and execution remain in the main window. */
  chatWindow?: {
    kind: "floating";
    spaceId: string;
    returnToMain: () => Promise<void>;
    onPrepare: (listener: () => boolean | Promise<boolean>) => () => void;
  };
  servers?: {
    list(): Promise<{ servers: (DesktopSetup & { name: string; color?: string })[]; current: string | null }>;
    manage(url?: string): Promise<void>;
    /** Device-local connection identity. Never changes a remote server or its permissions. */
    updateIdentity?(url: string, identity: { name: string; color: string }): Promise<void>;
  };
  companions?: {
    state: () => Promise<DesktopCompanionPreferences>;
    save: (value: DesktopCompanionPreferences) => Promise<DesktopCompanionPreferences>;
    displays: () => Promise<{ id: number; label: string }[]>;
    publish: (snapshot: DesktopCompanionSnapshot) => Promise<void>;
    openChat?: (target: { scope: string; botId: string }) => Promise<void>;
    onQuestion?: (listener: (request: DesktopQuestionRequest) => void) => () => void;
    questionResult?: (result: DesktopQuestionResult) => Promise<void>;
    onSelect: (listener: (target: { scope: string; botId: string; respond?: boolean }) => void) => () => void;
  };
  /** Preferences of this computer. Older releases have no settings bridge. */
  localScripts?: {
    state: () => Promise<{ enabled: boolean; requestsPerHour: number; endpoint: string | null; configPath: string }>;
    configure: (patch: { enabled?: boolean; requestsPerHour?: number }) => Promise<{ enabled: boolean; requestsPerHour: number; endpoint: string | null; configPath: string }>;
  };
  settings?: {
    state: () => Promise<DesktopBehaviorSettings>;
    update: (patch: Partial<DesktopBehaviorSettings>) => Promise<DesktopBehaviorSettings>;
    fonts?: () => Promise<string[]>;
    logo?: (png: string | null) => Promise<void>;
  };
  localVoice?: {
    status: () => Promise<LocalVoiceStatus>;
    prepare: () => Promise<void>;
    prepareModel?: (kind: LocalVoiceModelKind) => Promise<void>;
    removeModel?: (kind: LocalVoiceModelKind) => Promise<void>;
    transcribe: (samples: Float32Array) => Promise<{ text?: string }>;
    speak: (input: { text: string; language: string; speed: number }) => Promise<{ samples?: Float32Array; sampleRate?: number }>;
    stop: () => Promise<void>;
  };

  videoEdit?: import("./video-edit.js").VideoEditBridge;
  appsStudio?: import("./app-studio.js").AppsStudioBridge;
  projectRunner?: ProjectRunnerBridge;
  /** Isolated native browser displayed inside the conversation's preview panel. */
  preview?: {
    show: (request: { id: string; url: string; bounds: PreviewBounds }) => Promise<void>;
    layout: (request: { id: string; bounds: PreviewBounds | null }) => Promise<void>;
    command: (request: {
      id: string;
      action: "back" | "forward" | "reload" | "select";
      enabled?: boolean;
    }) => Promise<void>;
    close: (id: string) => Promise<void>;
    onChanged: (listener: (state: ProjectBrowserState) => void) => () => void;
  };
  development?: {
    isDevelopment?: boolean;
    open?: (botId?: string) => Promise<{ opened: boolean; error?: string }>;
    state?: () => Promise<{ active: boolean }>;
    connect?: (botId: string) => Promise<void>;
    onChanged?: (listener: (state: { active: boolean }) => void) => () => void;
  };
  /** Present only when the native installer bundles the contribution runtime. */
  runtime?: DesktopRuntimeBridge;
  /** Optional for compatibility with older desktop releases. */
  badge?: {
    set: (count: number) => Promise<boolean>;
  };
  /** Native OS delivery; absent on older installed Desktop versions. */
  notifications?: {
    clear: () => Promise<void>;
    status: () => Promise<{ supported: boolean; settingsAvailable: boolean }>;
    show: (input: { title: string; body: string; tag: string; url: string; silent: boolean }) => Promise<void>;
    openSettings: () => Promise<boolean>;
    onOpen: (listener: (url: string) => void) => () => void;
  };
  computer?: {
    /** Native main persists host choice through its local capability, never a user session. */
    managesHostChoice?: boolean;
    requestAccess: () => Promise<boolean>;
    revokeAccess: () => Promise<void>;
    /** Bind this Mico to its native workspace without opening a folder chooser. */
    connect?: (botId: string) => Promise<void>;
    connected?: (botId: string) => Promise<boolean>;
    chooseProject?: (botId: string) => Promise<DesktopMicoFolder | null>;
    prepareTask?: (request: { botId: string; taskThreadId: string }) => Promise<void>;
    project?: (botId: string) => Promise<DesktopMicoFolder | null>;
    projectAvailable?: () => Promise<boolean>;
    onConfigure: (listener: () => void) => () => void;
  };
  /** Optional for compatibility with older desktop releases. */
  passkeys?: {
    /** Relying parties this build is associated with for system passkeys (macOS); others fail. */
    rpIds: () => Promise<string[]>;
  };
  platform: string;
  /** Host-owned controls survive navigation (OS or local strip); absent in older releases. */
  nativeWindowFrame?: boolean;
  window: {
    close: () => Promise<void>;
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    state: () => Promise<{ minimized: boolean; maximized: boolean; fullScreen: boolean }>;
  };
  update: RakazoDesktopUpdate;
  oauth: {
    /**
     * Open system-browser auth. A redirect_uri must be HTTP loopback with state;
     * URLs without a redirect use backend polling. Optional for older desktops.
     */
    open?: (authorizationUrl: string) => Promise<void>;
    cancel?: (authorizationUrl: string) => Promise<void>;
    /**
     * Authorization codes captured from the system browser or a legacy popup.
     * Returns an unsubscribe function.
     */
    onCallback: (listener: (callback: RakazoDesktopOAuthCallback) => void) => () => void;
  };
}

export interface DesktopBehaviorSettings {
  launchAtLogin: boolean | null;
  keepRunningInBackground: boolean;
  keepRemoteSessions?: boolean;
  keepAwake: boolean | null;
  keepAwakeOnBattery: boolean;
  externalLinkTarget: "system" | "app";
}

export interface PreviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ProjectBrowserState {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  selecting: boolean;
  error?: string;
  selection?: { selector: string; text: string; screenshot?: string };
}

/**
 * How the desktop app was pointed at a Rakazo server during first-run setup.
 * `new` is the Docker Compose stack this app installs and runs on the same computer.
 */
export type DesktopInstanceMode = "new" | "existing";

export interface DesktopSetup {
  mode: DesktopInstanceMode;
  serverUrl: string;
}

export interface DesktopSetupState {
  defaultLocalUrl: string;
  /** Hosted Rakazo origin, saved as an `existing` server when chosen. */
  cloudUrl: string;
  saved: DesktopSetup | null;
  /** Present when a saved or newly selected server could not be reopened. */
  error?: string;
}

export interface DesktopReachability {
  ok: boolean;
  /** HTTP status when the server answered, absent when it could not be reached. */
  status?: number;
  /** Normalized URL that was probed, absent when the input was not a usable URL. */
  url?: string;
  error?: string;
}

export interface DesktopStackProbeResponse {
  ok: true;
  imageTag: string;
}

/**
 * Lifecycle of the Docker Compose stack the desktop app manages for mode `new`.
 * `docker-missing` and `docker-not-running` wait for the person to act; `ready` and
 * `failed` are terminal until the next start.
 */
export type DesktopLocalStackPhase =
  | "idle"
  | "checking-docker"
  | "docker-missing"
  | "docker-not-running"
  | "preparing"
  | "pulling"
  | "starting"
  | "waiting-healthy"
  | "ready"
  | "failed";

export interface DesktopLocalStackState {
  phase: DesktopLocalStackPhase;
  /** One actionable sentence; null while the stack is progressing normally. */
  message: string | null;
  /** Bounded tail of docker output for the current attempt. */
  output: string[];
  /** Bytes pulled per image layer in the current attempt; the sum is the only progress Docker reports. */
  layerBytes: Record<string, number>;
  /** Image tag this app launches (`v<app version>` for installed builds, `edge` otherwise). */
  imageTag: string;
}

export type DesktopSetupLink = "docker-desktop" | "orbstack" | "docker-engine";

/**
 * Bridge exposed only to the first-run setup window. The app window keeps the
 * narrower `rakazoDesktop` bridge so a connected server can never re-point the app.
 */
export interface RakazoSetup {
  servers?: () => Promise<(DesktopSetup & { name: string })[]>;
  forgetServer?: (url: string) => Promise<(DesktopSetup & { name: string })[]>;
  /** Used only to reserve space for native window controls in the local setup UI. */
  platform: string;
  state: () => Promise<DesktopSetupState>;
  test: (url: string) => Promise<DesktopReachability>;
  save: (setup: DesktopSetup) => Promise<{ ok: boolean; error?: string }>;
  quit: () => Promise<void>;
  /** Opens one of the Docker install pages in the system browser. */
  openLink: (link: DesktopSetupLink) => Promise<void>;
  /** The Docker Compose stack this app installs and runs for mode `new`. */
  stack: {
    state: () => Promise<DesktopLocalStackState>;
    /** Starts (or retries) the stack; a no-op while a start is already in flight. */
    start: () => Promise<DesktopLocalStackState>;
    /** Fires on every state change so progress never depends on a renderer timer. */
    onChange: (listener: (state: DesktopLocalStackState) => void) => void;
  };
}

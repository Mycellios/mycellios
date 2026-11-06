import type { DesktopRuntimeBridge } from "../../../../contracts/desktop-runtime.js";
import type { ProjectRunnerBridge } from "../../../../contracts/project-runner.js";
export type { ProjectRunState, ProjectRunConfig, ProjectRunnerBridge } from "../../../../contracts/project-runner.js";

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
  supportsForceRestart?: boolean;
  restartMode?: "whenIdle" | "now";
  waitingFor?: "local_work" | "unsaved_work";
}

export interface RakazoDesktopUpdate {
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

export interface RakazoDesktopOAuthCallback {
  code: string;
  state?: string;
}

export interface RakazoDesktop {
  localVoice?: {
    status: () => Promise<{ ready: boolean; preparing: boolean; downloaded: number; total: number; error?: string }>;
    prepare: () => Promise<void>;
    transcribe: (samples: Float32Array) => Promise<{ text?: string }>;
    speak: (input: { text: string; language: string; speed: number }) => Promise<{ samples?: Float32Array; sampleRate?: number }>;
    stop: () => Promise<void>;
  };

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
  computer?: {
    /** Native main persists host choice through its local capability, never a user session. */
    managesHostChoice?: boolean;
    requestAccess: () => Promise<boolean>;
    revokeAccess: () => Promise<void>;
    /** Bind this Mico to its native workspace without opening a folder chooser. */
    connect?: (botId: string) => Promise<void>;
    connected?: (botId: string) => Promise<boolean>;
    chooseProject?: (botId: string) => Promise<{ name: string; path: string } | null>;
    prepareTask?: (request: { botId: string; taskThreadId: string }) => Promise<void>;
    project?: (botId: string) => Promise<{ name: string; path: string } | null>;
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

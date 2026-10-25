import { Badge as UiBadge } from "./ui/primitives";
import { AgentNavigationLink, Sidebar, SidebarFooter } from "./ui/Sidebar";
import { DialogPanel as UiDialogPanel } from "./ui/primitives";
import { Button as UiButton, Card as UiCard, Disclosure as UiDisclosure, DisclosureSummary as UiDisclosureSummary, FieldLabel as UiFieldLabel, Form as UiForm, Heading as UiHeading, Input as UiInput, Link as UiLink, Select as UiSelect, Table as UiTable, TableBody as UiTableBody, TableCell as UiTableCell, TableHead as UiTableHead, TableHeader as UiTableHeader, TableRow as UiTableRow, Text as UiText, Textarea as UiTextarea } from "./ui/primitives";
import { AppSelect, Toggle, PageTitle, PanelDisclosure, SummaryStrip, Metric, Empty, PanelLoading } from "./ui/patterns";
import {
  Activity,
  ArrowRight,
  Bot,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CirclePower,
  Code2,
  Coins,
  Copy,
  Cpu,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  Gauge,
  GitFork,
  Globe2,
  HardDrive,
  History,
  Laptop,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  MemoryStick,
  Menu,
  MessageSquareText,
  Minus,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  ScrollText,
  Sparkles,
  Smartphone,
  SunMoon,
  Timer,
  Trash2,
  UserRound,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "@fontsource-variable/manrope";
import "./overview.css";
import "./panel-minimal.css";
import type {
  DashboardDeployment,
  DashboardWorker,
  FleetContributionCommandResponse,
  FleetContributionStatus,
  HubCatalogModel,
  HubCatalogPage,
  HubCatalogSearchInput,
  HubCatalogSort,
  RequestModelInput,
  RequestedModelCapacity,
  SystemLogEntry,
  SystemLogSnapshot,
  WorkerCredentialSummary,
} from "../../src/contracts/dashboard";
import { isAvailableInferenceWorker } from "./inference-selection";
import type { NetworkExecutionTrace } from "../../src/contracts/types";
import { projectObservedTopology } from "./network-topology";
import { type ProductStatePresentation } from "./product-state";
import type { NativeBuildIdentity } from "../../src/contracts/build-identity";
import type { BenchmarkMeasurement, BenchmarkRun } from "../../src/benchlab/types";
import { DownloadsPage } from "./Downloads";
import { EarnQuickMenu } from "./EarnQuickMenu";
import { AccountDetails, MetaMaskProviderIcon } from "./AccountDetails";
import { TABLE_PAGE_SIZE, TablePagination } from "./TablePagination";
import { firstFocusable, trapDialogTab, formatCompactNumber, formatCompactTokens, formatPower, shortId, shortFingerprint, formatMemory, relativeTime } from "./panel-ui-utilities";
const brandIcon = "/assets/brand/favicon.png";
const Contribute = lazy(() => import("./Contribute").then((module) => ({ default: module.Contribute })));

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

import {
  benchmarkRunSnapshot,
  benchmarkFilterValues,
  benchmarkComparisonNarrative,
  benchmarkTrendRuns,
  compareBenchmarkRuns,
  defaultBenchmarkBaseline,
  EMPTY_BENCHMARK_FILTERS,
  filterBenchmarkRuns,
  measurementBackends,
  type BenchmarkFilters,
  type BenchmarkRunComparison,
  type BenchmarkRunSnapshot,
} from "./benchmark-comparison";
import { applySeoMetadata } from "./seo";
import {
  EmailConfirmationRequired,
  clearAuthSession,
  isDefinitiveAuthFailure,
  sessionSurvivesRefreshFailure,
  loadAuthConfig,
  loadAuthProviders,
  loadNetworkIdentity,
  linkOAuthIdentity,
  restoreAuthSession,
  subscribeAuthSession,
  validAuthSession,
  signIn,
  signInWithGoogle,
  signInWithMetaMask,
  signInWithX,
  signOut,
  signUp,
  type AuthSession,
  type NetworkIdentity,
  type OAuthProvider,
  type PublicAuthConfig,
} from "./auth";
import {
  loadApiAccount,
  loadApiUsage,
  loadOperatorEvidence,
  configuredApiUrl,
  type ApiAccount,
  type ApiUsage,
  type OperatorEvidenceSnapshot,
} from "./api-access";
import "./panel.css";

import "./panel-downloads.css";
import "./panel-desktop.css";
import "./ui/dark-theme.css";

type PanelView = "overview" | "history" | "nodes" | "models" | "jobs" | "tests" | "logs" | "contribute" | "join" | "downloads" | "admin";
type PanelMode = "simple" | "developer";

interface PanelProps {
  mobileEntry?: boolean;
  accountEntry?: boolean;
}

interface PublicGpu {
  id: string;
  vendor: string;
  model: string;
  physicalVramMb: number;
  sharedMemoryMb?: number;
  offeredVramMb: number;
  freeOfferedVramMb: number;
  utilizationPct?: number;
  temperatureC?: number;
  powerW?: number;
}

interface PublicDeployment {
  deploymentId: string;
  model: string;
  mode: string;
  adapter?: string;
  freeSlots: number;
  tokensPerSecond: number;
  throughputSource?: "measured" | "estimated" | "configured" | "default";
  ttftMs?: number;
  execution?: DashboardDeployment["execution"];
}

interface PublicWorker {
  id: string;
  kind: "desktop" | "browser" | "cell";
  status: "online" | "suspect" | "offline" | "draining";
  connected: boolean;
  region: string;
  offeredVramMb: number;
  reliability: number;
  jobsCompleted: number;
  lastSeenAt: string;
  quarantined: boolean;
  quarantineExpiresAt: string | null;
  gpus: PublicGpu[];
  deployments: PublicDeployment[];
  executionNodeId?: string;
  computeMode?: DashboardWorker["computeMode"];
  agentVersion?: string;
  buildIdentity?: NativeBuildIdentity;
  acceleration?: DashboardWorker["acceleration"];
  isolation?: DashboardWorker["isolation"];
  observedCapability?: {
    schema: "mycellios-observed-node-capability/1";
    probe: { state: "missing" | "verified" | "stale" | "invalid"; validUntil: string | null };
    canary: { state: "missing" | "verified" | "stale" | "invalid"; verifiedDeployments: Array<{ deploymentId: string }> };
    eligibility: { activation: boolean; serving: boolean; reasons: string[] };
  };
  mobile?: {
    platform: string;
    backend: "webgpu" | "cpu";
    performanceLevel: string;
    wakeLock: boolean;
    estimatedGflops: number;
    verifiedTasks: number;
  };
}

interface PublicJob {
  id: string;
  model: string;
  status: string;
  workerId: string | null;
  inputTokens: number;
  outputTokens: number;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PublicSnapshot {
  capturedAt: string;
  version: string;
  buildIdentity: NativeBuildIdentity | null;
  summary: {
    registered: number;
    connected: number;
    online: number;
    mobile: number;
    offeredVramMb: number;
    completedJobs: number;
  };
  workers: PublicWorker[];
  models: Array<{ id: string; replicas: number; pipelines: number }>;
  requestedModels: RequestedModelCapacity[];
  jobs: PublicJob[];
  recentNetworkTraces?: NetworkExecutionTrace[];
}

type NetworkHistoryRange = "24h" | "7d" | "30d" | "90d";

interface NetworkTelemetrySample {
  capturedAt: string;
  registeredNodes: number;
  connectedNodes: number;
  onlineNodes: number;
  browserNodes: number;
  activeModels: number;
  modelReplicas: number;
  modelPipelines: number;
  offeredVramMb: number;
  freeVramMb: number;
  inflightJobs: number;
  runningJobs: number;
  completedJobs: number;
}

interface NetworkTelemetryHistory {
  capturedAt: string;
  intervalMinutes: number;
  retentionDays: number;
  range: NetworkHistoryRange;
  samples: NetworkTelemetrySample[];
}

const EMPTY: PublicSnapshot = {
  capturedAt: new Date(0).toISOString(),
  version: "—",
  buildIdentity: null,
  summary: { registered: 0, connected: 0, online: 0, mobile: 0, offeredVramMb: 0, completedJobs: 0 },
  workers: [],
  models: [],
  requestedModels: [],
  jobs: [],
  recentNetworkTraces: [],
};

const sharedNavItems: Array<{ id: PanelView; label: string; icon: typeof Network }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "history", label: "History", icon: History },
  { id: "nodes", label: "Nodes", icon: Server },
  { id: "jobs", label: "Tasks", icon: Activity },
  { id: "tests", label: "Tests", icon: Gauge },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "models", label: "Models", icon: Boxes },
  { id: "contribute", label: "Run", icon: Zap },
  { id: "downloads", label: "Downloads", icon: Download },
  { id: "admin", label: "Admin", icon: ShieldCheck },
];

const simplePanelViews = new Set<PanelView>(["overview", "history", "contribute", "downloads"]);
const developerPanelViews = new Set<PanelView>(["nodes", "jobs", "tests", "logs", "models"]);
const legacyPanelViews: Readonly<Record<string, PanelView>> = {
  network: "history",
  tasks: "jobs",
  chat: "overview",
  inference: "overview",
  join: "contribute",
};

function requestedPanelView(search: string): PanelView | null {
  const requested = new URLSearchParams(search).get("view");
  return requested ? legacyPanelViews[requested] ?? requested as PanelView : null;
}

function initialPanelMode(): PanelMode {
  const requested = requestedPanelView(window.location.search);
  if (requested && developerPanelViews.has(requested)) return "developer";
  return window.localStorage.getItem("mycellios.panel-mode") === "developer" ? "developer" : "simple";
}

function initialView(mobileEntry: boolean): PanelView {
  return panelViewFromLocation(window.location.pathname, window.location.search, mobileEntry);
}

export function panelViewFromLocation(pathname: string, search: string, mobileEntry = false): PanelView {
  const requested = requestedPanelView(search);
  if (sharedNavItems.some((item) => item.id === requested)) return requested as PanelView;
  if (mobileEntry || pathname.startsWith("/mobile")) return "contribute";
  if (pathname === "/join") return "contribute";
  if (pathname === "/downloads") return "downloads";
  if (pathname === "/admin") return "admin";
  return "overview";
}

export function panelViewAllowed(view: PanelView, advancedAccess: boolean): boolean {
  return view !== "admin" && !developerPanelViews.has(view) || advancedAccess;
}

export type PanelIssue = {
  source: "coordinator" | "runtime";
  message: string;
};

export function panelIssueForErrors(
  connectionError: string | null,
  runtimeError: string | null,
): PanelIssue | null {
  if (connectionError) return { source: "coordinator", message: connectionError };
  if (runtimeError) return { source: "runtime", message: runtimeError };
  return null;
}

export function ApiQuotaBadge({ account }: { account: ApiAccount | null }) {
  if (!account) return null;
  return <span
    className="panel-balance-badge tokens"
    aria-label={`API token balance: ${account.token_balance}`}
    title="Current inference token balance; not money or compute credit"
  ><Coins size={14} />{formatCompactTokens(account.token_balance)} API tokens</span>;
}

function Panel({ mobileEntry = false, accountEntry = false }: PanelProps = {}) {
  const localBrowser = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(window.location.hostname);
  const localProductionProxy = localBrowser && window.location.port === "4174";
  const dashboardEntry = !mobileEntry && window.location.pathname === "/dashboard";
  const [panelMode, setPanelMode] = useState<PanelMode>(initialPanelMode);
  const [view, setView] = useState<PanelView>(() => initialView(mobileEntry));
  const [snapshot, setSnapshot] = useState<PublicSnapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState<PanelIssue | null>(null);
  const coordinatorError = issue?.source === "coordinator" ? issue.message : null;
  const coordinatorStatus = coordinatorError ? "Unavailable" : loading ? "Connecting" : "Connected";
  const error = issue?.message ?? null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return window.localStorage.getItem("mycellios.sidebar-collapsed") === "true"; }
    catch { return false; }
  });
  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      try { window.localStorage.setItem("mycellios.sidebar-collapsed", String(next)); } catch { /* Keep the toggle usable when storage is unavailable. */ }
      return next;
    });
  };
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarCloseButtonRef = useRef<HTMLButtonElement>(null);
  const mainContentRef = useRef<HTMLElement>(null);
  const [modelAdminToken, setModelAdminToken] = useState(() =>
    window.sessionStorage.getItem("mycellios-model-admin-token") ?? "",
  );
  const [authConfig, setAuthConfig] = useState<PublicAuthConfig>({ enabled: false });
  const apiRequestBaseUrl = authConfig.publicApiBaseUrl;
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const authSessionRef = useRef<AuthSession | null>(null);
  const [networkIdentity, setNetworkIdentity] = useState<NetworkIdentity | null>(null);
  const identityRequestSeq = useRef(0);
  const [authReady, setAuthReady] = useState(false);
  const [apiAccount, setApiAccount] = useState<ApiAccount | null>(null);
  const [authOpen, setAuthOpen] = useState(accountEntry);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = window.localStorage.getItem("mycellios.theme");
    if (saved === "light" || saved === "dark") return saved;
    return "light";
  });

  const canManageModels = networkIdentity?.role === "owner"
    || networkIdentity?.role === "admin"
    || networkIdentity?.role === "operator";

  useEffect(() => { authSessionRef.current = authSession; }, [authSession]);

  useEffect(() => subscribeAuthSession((session) => {
    const requestSeq = ++identityRequestSeq.current;
    authSessionRef.current = session;
    setAuthSession(session);
    setNetworkIdentity(null);
    setApiAccount(null);
    if (!session) {
      return;
    }
    void loadNetworkIdentity(session.accessToken).then((identity) => {
      if (identityRequestSeq.current === requestSeq) setNetworkIdentity(identity);
    }).catch(() => undefined);
    if (authConfig.apiAccessEnabled) {
      void loadApiAccount(session.accessToken, apiRequestBaseUrl).then((account) => {
        if (identityRequestSeq.current === requestSeq) setApiAccount(account);
      }).catch(() => undefined);
    }
  }), [apiRequestBaseUrl, authConfig.apiAccessEnabled]);

  const getValidSession = useCallback(async (forceRefresh = false): Promise<AuthSession | null> => {
    const current = authSessionRef.current;
    if (!current) return null;
    const initialRequestSeq = identityRequestSeq.current;
    try {
      const next = await validAuthSession(authConfig, current, forceRefresh);
      if (identityRequestSeq.current !== initialRequestSeq || authSessionRef.current !== current) return null;
      if (next !== current) {
        const requestSeq = ++identityRequestSeq.current;
        authSessionRef.current = next;
        setAuthSession(next);
        setNetworkIdentity(null);
        setApiAccount(null);
        void loadNetworkIdentity(next.accessToken).then((identity) => {
          if (identityRequestSeq.current === requestSeq) setNetworkIdentity(identity);
        }).catch(() => undefined);
        if (authConfig.apiAccessEnabled) {
          void loadApiAccount(next.accessToken, apiRequestBaseUrl).then((account) => {
            if (identityRequestSeq.current === requestSeq) setApiAccount(account);
          }).catch(() => undefined);
        }
      }
      return next;
    } catch (caught) {
      if (identityRequestSeq.current !== initialRequestSeq || authSessionRef.current !== current) return null;
      if (isDefinitiveAuthFailure(caught)) {
        clearAuthSession();
        identityRequestSeq.current += 1;
        authSessionRef.current = null;
        setAuthSession(null);
        setApiAccount(null);
        setNetworkIdentity(null);
        return null;
      }
      if (sessionSurvivesRefreshFailure(current, caught)) return current;
      setNetworkIdentity(null);
      setApiAccount(null);
      return null;
    }
  }, [apiRequestBaseUrl, authConfig]);
  const advancedAccess = (localBrowser && !localProductionProxy) || canManageModels;
  const navItems = useMemo(() => {
    return sharedNavItems.filter((item) =>
      panelViewAllowed(item.id, advancedAccess)
      && (panelMode === "developer" || simplePanelViews.has(item.id)));
  }, [advancedAccess, panelMode]);
  const requiresModelAdminToken = (!localBrowser || localProductionProxy) && !canManageModels;
  const snapshotRequestPending = useRef(false);
  const refresh = useCallback(async () => {
    if (snapshotRequestPending.current) return;
    snapshotRequestPending.current = true;
    try {
      const response = await fetch("/public/v1/snapshot", { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setSnapshot(await response.json() as PublicSnapshot);
      setIssue(null);
    } catch (caught) {
      setIssue({
        source: "coordinator",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      snapshotRequestPending.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    const liveViews = new Set<PanelView>(["overview", "nodes", "models", "jobs", "logs"]);
    const intervalMs = liveViews.has(view) ? 5_000 : 15_000;
    const schedule = () => {
      if (document.visibilityState === "visible") timer = window.setInterval(() => void refresh(), intervalMs);
    };
    const handleVisibility = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
      if (document.visibilityState === "visible") {
        void refresh();
        schedule();
      }
    };
    void refresh();
    schedule();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh, view]);

  useEffect(() => {
    if (!menuOpen) return;

    const focusFrame = window.requestAnimationFrame(() => sidebarCloseButtonRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    const closeBeyondCompactLayout = () => {
      if (!window.matchMedia("(max-width: 1120px)").matches) setMenuOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeBeyondCompactLayout);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeBeyondCompactLayout);
    };
  }, [menuOpen]);

  useEffect(() => {
    let cancelled = false;
    const initialRequestSeq = identityRequestSeq.current;
    void (async () => {
      try {
        const config = await loadAuthConfig(false);
        if (cancelled) return;
        setAuthConfig(config);
        void loadAuthProviders(config).then((withProviders) => {
          const providers = withProviders.providers;
          if (cancelled || !providers) return;
          setAuthConfig((current) => current.url === config.url
            ? { ...current, providers }
            : current);
        });
        const session = await restoreAuthSession(config);
        if (cancelled || identityRequestSeq.current !== initialRequestSeq || !session) return;
        const requestSeq = ++identityRequestSeq.current;
        authSessionRef.current = session;
        setAuthSession(session);
        const identity = await loadNetworkIdentity(session.accessToken).catch(() => null);
        if (!cancelled && identityRequestSeq.current === requestSeq) {
          setNetworkIdentity(identity);
          if (config.apiAccessEnabled) {
            const account = await loadApiAccount(session.accessToken, config.publicApiBaseUrl).catch(() => null);
            if (!cancelled && identityRequestSeq.current === requestSeq) setApiAccount(account);
          }
        }
      } catch {
        if (!cancelled && identityRequestSeq.current === initialRequestSeq) {
          setAuthSession(null);
          setNetworkIdentity(null);
          setApiAccount(null);
        }
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!authSession || !authConfig.enabled) return;
    const delay = Math.max(1_000, authSession.expiresAt - Date.now() - 90_000);
    const timer = window.setTimeout(() => void getValidSession(), delay);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void getValidSession();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [authConfig.enabled, authSession, getValidSession]);

  useEffect(() => {
    if (!authReady || advancedAccess) return;
    if (panelMode === "developer") {
      setPanelMode("simple");
      window.localStorage.setItem("mycellios.panel-mode", "simple");
    }
    if (!panelViewAllowed(view, false)) {
      setView("overview");
      window.history.replaceState({}, "", dashboardEntry ? "/dashboard" : "/network");
    }
  }, [advancedAccess, authReady, panelMode, view]);

  useEffect(() => {
    const onPopState = () => {
      const requested = panelViewFromLocation(
        window.location.pathname,
        window.location.search,
        mobileEntry,
      );
      const next = panelViewAllowed(requested, advancedAccess) ? requested : "overview";
      setView(next);
      setMenuOpen(false);
      if (next !== requested) window.history.replaceState({}, "", dashboardEntry ? "/dashboard" : "/network");
      window.requestAnimationFrame(() => mainContentRef.current?.focus());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [advancedAccess, mobileEntry]);

  function changePanelMode(next: PanelMode) {
    setPanelMode(next);
    window.localStorage.setItem("mycellios.panel-mode", next);
    if (next === "simple" && developerPanelViews.has(view)) navigate("overview");
  }

  function toggleTheme() {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      window.localStorage.setItem("mycellios.theme", next);
      return next;
    });
  }

  function navigate(next: PanelView) {
    if (!panelViewAllowed(next, advancedAccess)) next = "overview";
    setView(next);
    setMenuOpen(false);
    const path = mobileEntry ? "/browser/" : dashboardEntry ? "/dashboard" : next === "downloads" ? "/downloads" : next === "admin" ? "/admin" : "/network";
    const query = mobileEntry
      ? next === "contribute" ? "" : `?view=${next}`
      : dashboardEntry
        ? next === "overview" ? "" : `?view=${next}`
      : next === "overview" || next === "downloads" || next === "admin" ? "" : `?view=${next}`;
    const target = `${path}${query}`;
    if (`${window.location.pathname}${window.location.search}` !== target) {
      window.history.pushState({}, "", target);
    }
    applySeoMetadata(path);
    window.requestAnimationFrame(() => mainContentRef.current?.focus());
  }

  function closeNavigation() {
    setMenuOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }

  // An administrator token can authorize shared mutations or supplement the account session.
  function administrativeRequestHeaders(): Record<string, string> {
    const token = modelAdminToken.trim();
    if (authSession) {
      return {
        authorization: `Bearer ${authSession.accessToken}`,
        ...(token ? { "x-mycellios-admin-token": token } : {}),
      };
    }
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  async function removeWorker(workerId: string) {
    const response = await fetch(`/public/v1/workers/${encodeURIComponent(workerId)}`, {
      method: "DELETE",
      headers: administrativeRequestHeaders(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
    }
    await refresh();
  }

  async function clearOfflineWorkers() {
    const response = await fetch("/public/v1/workers/clear-offline", {
      method: "POST",
      headers: administrativeRequestHeaders(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
    }
    await refresh();
  }

  async function listWorkerCredentials(): Promise<WorkerCredentialSummary[]> {
    const response = await fetch("/public/v1/worker-credentials", {
      cache: "no-store",
      headers: administrativeRequestHeaders(),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as {
        error?: { message?: string };
      } | null;
      throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
    }
    const body = await response.json() as { data: WorkerCredentialSummary[] };
    return body.data;
  }

  async function revokeWorkerCredential(
    credential: Pick<WorkerCredentialSummary, "identityKind" | "identityId" | "fingerprint">,
    reason: string,
  ): Promise<void> {
    const response = await fetch(
        `/public/v1/worker-credentials/${encodeURIComponent(credential.identityKind)}/${encodeURIComponent(credential.identityId)}/revoke`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...administrativeRequestHeaders(),
          },
          body: JSON.stringify({
            expectedFingerprint: credential.fingerprint,
            reason,
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
    if (!response.ok) {
        const body = await response.json().catch(() => null) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
    }
    await refresh();
  }

  async function requestModel(input: RequestModelInput, adminToken: string) {
    const token = adminToken.trim();
    if (requiresModelAdminToken && !token) throw new Error("Enter the network administrator token.");
    if (token) {
      window.sessionStorage.setItem("mycellios-model-admin-token", token);
      setModelAdminToken(token);
    }
    const response = await fetch("/public/v1/requested-models", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authSession
          ? {
              authorization: `Bearer ${authSession.accessToken}`,
              ...(token ? { "x-mycellios-admin-token": token } : {}),
            }
          : token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
    }
    await refresh();
  }

  const searchHubModels = useCallback(async (input: HubCatalogSearchInput): Promise<HubCatalogPage> => {
    const parameters = new URLSearchParams({
      q: input.query,
      sort: input.sort ?? "downloads",
      limit: String(input.limit ?? 50),
    });
    if (input.cursor) parameters.set("cursor", input.cursor);
    const response = await fetch(`/public/v1/huggingface-models?${parameters.toString()}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
    }
    return response.json() as Promise<HubCatalogPage>;
  }, []);

  async function removeRequestedModel(modelId: string, adminToken: string) {
    const token = adminToken.trim();
    if (requiresModelAdminToken && !token) throw new Error("Enter the network administrator token.");
    const response = await fetch(`/public/v1/requested-models/${encodeURIComponent(modelId)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(90_000),
      ...((authSession || token)
        ? {
            headers: authSession
              ? {
                  authorization: `Bearer ${authSession.accessToken}`,
                  ...(token ? { "x-mycellios-admin-token": token } : {}),
                }
              : { authorization: `Bearer ${token}` },
          }
        : {}),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await refresh();
  }

  const publicLink = (path: string) => path;
  const configuredApiBase = authConfig.publicApiBaseUrl ?? "/v1";
  const apiBaseUrl = configuredApiBase.startsWith("http")
    ? configuredApiBase
    : `${window.location.origin}${configuredApiBase.startsWith("/") ? "" : "/"}${configuredApiBase}`;

  async function disconnectAccount() {
    const session = authSessionRef.current;
    identityRequestSeq.current += 1;
    authSessionRef.current = null;
    setAuthSession(null);
    setNetworkIdentity(null);
    setApiAccount(null);
    if (session) await signOut(authConfig, session);
  }

  const closeAccount = useCallback(() => {
    if (accountEntry && window.location.pathname === "/account") {
      window.history.replaceState({}, "", "/dashboard");
      applySeoMetadata("/dashboard");
    }
    setAuthOpen(false);
  }, [accountEntry]);

  return (
    <div className="public-panel-viewport">
      <div
        className={`public-panel theme-${theme} panel-mode-${panelMode}${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
      >
      <UiLink className="panel-skip-link" href="#panel-main-content" inert={authOpen}>Skip to main content</UiLink>
      <Sidebar collapsed={sidebarCollapsed} open={menuOpen} inert={authOpen} onToggle={toggleSidebar} onClose={closeNavigation} closeButtonRef={sidebarCloseButtonRef} homeHref={publicLink("/")} logoSrc={brandIcon}>
        <nav id="panel-sidebar-links">
          {panelMode === "developer" && <span className="panel-nav-label">DEVELOPER TOOLS</span>}
          {navItems.map(({ id, label, icon: Icon }) => (
            <UiButton key={id} className={view === id ? "active" : ""} title={label} aria-label={label} aria-current={view === id ? "page" : undefined} onClick={() => navigate(id)}>
              <Icon size={18} /><span>{label}</span>{id === "nodes" && <b>{snapshot.summary.connected}</b>}
            </UiButton>
          ))}<AgentNavigationLink />
        </nav>
        {advancedAccess && <UiButton
          type="button"
          className={`panel-mode-toggle ${panelMode === "developer" ? "active" : ""}`}
          aria-pressed={panelMode === "developer"}
          title={panelMode === "developer" ? "Switch to the simple panel" : "Show developer tools"}
          onClick={() => changePanelMode(panelMode === "developer" ? "simple" : "developer")}
        >
          <Code2 size={18} />
          <span><strong>Developer mode</strong><small>{panelMode === "developer" ? "Advanced tools visible" : "Simple panel active"}</small></span>
          <i aria-hidden="true" />
        </UiButton>}
        <SidebarFooter
          accountLabel={(networkIdentity?.email ?? authSession?.user.email)?.split("@")[0] ?? (authSession ? "Account" : "Sign in")}
          accountTitle={authSession ? `Open account for ${networkIdentity?.email ?? authSession.user.email ?? "Mycellios user"}` : "Sign in to Mycellios"}
          onAccount={() => { setMenuOpen(false); setAuthOpen(true); }}
          theme={theme} onTheme={toggleTheme} status={coordinatorStatus}
          degraded={Boolean(coordinatorError) || loading} version={snapshot.version}
          earnMenu={<EarnQuickMenu
              earnUrl={`${window.location.origin}/earn`}
              browserUrl={publicLink("/browser/?autostart=1")}
              downloadsUrl={publicLink("/downloads")}
              external={false}
              onOpenEarn={() => window.location.assign("/earn")}
            />}
        />
      </Sidebar>
      {menuOpen && !authOpen && <UiButton className="panel-menu-backdrop" aria-label="Close navigation overlay" onClick={closeNavigation} />}

      <div className="panel-main" inert={authOpen}>
        <UiButton
          ref={menuButtonRef}
          className="panel-menu-button"
          aria-label={menuOpen ? "Close navigation" : "Show navigation labels"}
          aria-controls="panel-navigation"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((current) => !current)}
        ><Menu /></UiButton>

        {issue && <div className="panel-error" role="alert" aria-live="assertive" title={issue.message}><CircleAlert size={17} /> {issue.source === "coordinator" ? "Coordinator unavailable." : "This node could not join the network."} Retrying automatically.</div>}
        <main id="panel-main-content" ref={mainContentRef} className="panel-content" tabIndex={-1}>
          <div className="panel-content-scale">
            {loading && snapshot.capturedAt === EMPTY.capturedAt ? <PanelLoading /> : (
              <>
              {view === "overview" && <Overview snapshot={snapshot} connectionError={coordinatorError} onNavigate={navigate} publicLink={publicLink} external={false} apiBaseUrl={apiBaseUrl} earnUrl={`${window.location.origin}/earn`} developerMode={panelMode === "developer"} theme={theme} />}
              {view === "history" && <NetworkHistory endpoint="/public/v1/history" />}
              {view === "nodes" && advancedAccess && <Nodes snapshot={snapshot} onRemove={removeWorker} onClearOffline={clearOfflineWorkers} onListCredentials={listWorkerCredentials} onRevokeCredential={revokeWorkerCredential} />}
              {view === "models" && advancedAccess && <Models snapshot={snapshot} onSearch={searchHubModels} onRequest={requestModel} onRemove={removeRequestedModel} adminToken={modelAdminToken} requiresAdminToken={requiresModelAdminToken} secureTokenStorage={false} />}
              {view === "jobs" && advancedAccess && <Jobs
                snapshot={snapshot}
                operatorAccess={canManageModels}
                accessToken={authSession?.accessToken ?? null}
                getValidSession={getValidSession}
                apiBaseUrl={configuredApiUrl(authConfig.publicApiBaseUrl)}
              />}
              {view === "tests" && advancedAccess && <Tests canRunLocally={localBrowser && !localProductionProxy} />}
              {view === "logs" && advancedAccess && <SystemLogs snapshot={snapshot} connectionError={coordinatorError} />}
              {view === "contribute" && <Suspense fallback={<div className="panel-loading" role="status" aria-live="polite"><LoaderCircle className="spin" /><strong>Loading contribution tools</strong><span>Preparing the browser and node options…</span></div>}>
                <Contribute
                  accessToken={authSession?.accessToken ?? null}
                  authConfig={authConfig}
                  authSession={authSession}
                  getValidSession={getValidSession}
                  onSessionElevated={setAuthSession}
                  onSignIn={() => setAuthOpen(true)}
                  onOpenAccount={() => setAuthOpen(true)}
                  onNavigate={navigate}
                  network={{
                    connectedNodes: snapshot.summary.connected,
                    completedJobs: snapshot.summary.completedJobs,
                    traceCount: snapshot.recentNetworkTraces?.length ?? 0,
                  }}
                />
              </Suspense>}
              {view === "downloads" && <DownloadsPage title={<PageTitle eyebrow="CLIENTS" title="Downloads" copy="Native packages are listed here only when their release files are available." />} publicLink={publicLink} external={false} />}
              {view === "admin" && advancedAccess && <AssistantAdmin
                apiOrigin=""
                adminToken={modelAdminToken}
                authSession={authSession}
                onAdminTokenChange={(token) => {
                  setModelAdminToken(token);
                  if (token) window.sessionStorage.setItem("mycellios-model-admin-token", token);
                  else window.sessionStorage.removeItem("mycellios-model-admin-token");
                }}
              />}
              </>
            )}
          </div>
        </main>
      </div>
      {authOpen && <AccountModal
        key={authSession?.user.id ?? "guest"}
        ready={authReady}
        config={authConfig}
        onConfigLoaded={setAuthConfig}
        getValidSession={getValidSession}
        session={authSession}
        identity={networkIdentity}
        account={apiAccount}
        onAuthenticated={(session, identity) => {
          const requestSeq = ++identityRequestSeq.current;
          authSessionRef.current = session;
          setAuthSession(session);
          setNetworkIdentity(identity);
          setApiAccount(null);
          if (authConfig.apiAccessEnabled) {
            void loadApiAccount(session.accessToken, authConfig.publicApiBaseUrl).then((account) => {
              if (identityRequestSeq.current === requestSeq) setApiAccount(account);
            }).catch(() => undefined);
          }
          closeAccount();
        }}
        onRetryRole={async () => {
          const session = await getValidSession();
          if (!session) throw new Error("Your account session expired. Sign in again.");
          const requestSeq = identityRequestSeq.current;
          const identity = await loadNetworkIdentity(session.accessToken);
          if (identityRequestSeq.current === requestSeq && authSessionRef.current?.accessToken === session.accessToken) setNetworkIdentity(identity);
        }}
        onSignOut={() => { closeAccount(); void disconnectAccount(); }}
        initialTab={accountEntry && window.location.pathname === "/account" ? "billing" : "account"}
        onClose={closeAccount}
      />}
      </div>
    </div>
  );
}

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
  getValidSession: () => Promise<AuthSession | null>;
  session: AuthSession | null;
  identity: NetworkIdentity | null;
  account: ApiAccount | null;
  onAuthenticated: (session: AuthSession, identity: NetworkIdentity | null) => void;
  onRetryRole: () => Promise<void>;
  onSignOut: () => void;
  initialTab?: "account" | "billing" | "usage";
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
  const [accountTab, setAccountTab] = useState<"account" | "billing" | "usage">(initialTab);
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
        <div className="account-detail-tabs"><UiButton className={accountTab === "account" ? "active" : ""} onClick={() => setAccountTab("account")}>Account</UiButton><UiButton className={accountTab === "billing" ? "active" : ""} onClick={() => setAccountTab("billing")}>Plan</UiButton><UiButton className={accountTab === "usage" ? "active" : ""} onClick={() => setAccountTab("usage")}>Usage</UiButton></div>
        <AccountDetails tab={accountTab} titleId={titleId} session={session} identity={identity} account={account} usage={usage} usageBusy={usageBusy} linkBusy={linkBusy} roleBusy={roleBusy} providers={config.providers} error={error} onLinkProvider={(provider) => void linkProvider(provider)} onRetryRole={() => void retryRole()} onSignOut={onSignOut} />
      </> : <>
        <UiHeading as="h2" id={titleId}>{!emailAvailable ? "Continue to Mycellios" : mode === "signin" ? "Welcome back" : "Create your account"}</UiHeading>
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

interface AssistantAdminSettings {
  enabled: boolean;
  modelId: string | null;
  systemPrompt: string;
  welcomeMessage: string;
  suggestions: string[];
  maxOutputTokens: number;
  temperature: number;
  allowDeviceControl: boolean;
  updatedAt: number;
}

interface AssistantAdminRuntime {
  enabled: boolean;
  available: boolean;
  provider: "mycellios-network";
  configuredModel: string | null;
  selectedModel: string | null;
  availableModels: string[];
  welcomeMessage: string;
  suggestions: string[];
  allowDeviceControl: boolean;
  updatedAt: string | null;
}

interface AssistantAdminResponse {
  settings: AssistantAdminSettings;
  runtime: AssistantAdminRuntime;
}

export function AssistantAdmin({
  apiOrigin,
  adminToken,
  authSession,
  onAdminTokenChange,
}: {
  apiOrigin: string;
  adminToken: string;
  authSession: AuthSession | null;
  onAdminTokenChange: (token: string) => void;
}) {
  const [draftToken, setDraftToken] = useState(adminToken);
  const [settings, setSettings] = useState<AssistantAdminSettings | null>(null);
  const [runtime, setRuntime] = useState<AssistantAdminRuntime | null>(null);
  const [fleet, setFleet] = useState<FleetContributionStatus | null>(null);
  const [fleetAction, setFleetAction] = useState<"activate" | "pause" | null>(null);
  const [fleetConfirmation, setFleetConfirmation] = useState<"activate" | "pause" | null>(null);
  const [fleetResult, setFleetResult] = useState<FleetContributionCommandResponse | null>(null);
  const [fleetError, setFleetError] = useState<string | null>(null);
  const [suggestionsText, setSuggestionsText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const loadInFlight = useRef(false);
  const automaticLoadBlocked = useRef(false);

  function authorizationHeaders(token = draftToken): Record<string, string> {
    const trimmed = token.trim();
    if (authSession) {
      return {
        authorization: `Bearer ${authSession.accessToken}`,
        ...(trimmed ? { "x-mycellios-admin-token": trimmed } : {}),
      };
    }
    return trimmed ? { authorization: `Bearer ${trimmed}` } : {};
  }

  function applyResponse(response: AssistantAdminResponse) {
    setSettings(response.settings);
    setRuntime(response.runtime);
    setSuggestionsText(response.settings.suggestions.join("\n"));
  }

  async function requestFleetStatus(token = draftToken): Promise<FleetContributionStatus> {
    return fetch(`${apiOrigin}/public/v1/admin/fleet-contribution`, {
      cache: "no-store",
      headers: authorizationHeaders(token),
      signal: AbortSignal.timeout(4_000),
    }).then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
      }
      return response.json() as Promise<FleetContributionStatus>;
    });
  }

  async function load(token = draftToken, manual = false) {
    if (loadInFlight.current) return;
    if (manual) automaticLoadBlocked.current = false;
    if (automaticLoadBlocked.current) return;
    loadInFlight.current = true;
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const assistantRequest = fetch(`${apiOrigin}/public/v1/admin/assistant`, {
            cache: "no-store",
            headers: authorizationHeaders(token),
            signal: AbortSignal.timeout(12_000),
          }).then(async (response) => {
            if (!response.ok) {
              const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
              throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
            }
            return response.json() as Promise<AssistantAdminResponse>;
          });
      const [assistantResult, fleetStatus] = await Promise.all([
        assistantRequest,
        requestFleetStatus(token),
      ]);
      applyResponse(assistantResult);
      setFleet(fleetStatus);
      setFleetError(null);
      if (token.trim()) onAdminTokenChange(token.trim());
    } catch (caught) {
      setSettings(null);
      setRuntime(null);
      setFleet(null);
      automaticLoadBlocked.current = true;
      setError(errorText(caught));
    } finally {
      loadInFlight.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    // A signed-in user can still lack the network-admin role. Keep the admin
    // endpoints completely opt-in so opening this view never creates an
    // unauthorized probe or a noisy 503 when the provider is unavailable.
    automaticLoadBlocked.current = true;
    setLoading(false);
  }, [apiOrigin, authSession?.accessToken]);

  useEffect(() => {
    if (!settings) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void requestFleetStatus().then(setFleet).catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [settings, apiOrigin, authSession?.accessToken, draftToken]);

  function update<K extends keyof AssistantAdminSettings>(key: K, value: AssistantAdminSettings[K]) {
    setSettings((current) => current ? { ...current, [key]: value } : current);
    setSaved(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    const suggestions = suggestionsText
      .split("\n")
      .map((suggestion) => suggestion.trim())
      .filter(Boolean)
      .slice(0, 6);
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const payload = {
        enabled: settings.enabled,
        modelId: settings.modelId,
        systemPrompt: settings.systemPrompt,
        welcomeMessage: settings.welcomeMessage,
        suggestions,
        maxOutputTokens: settings.maxOutputTokens,
        temperature: settings.temperature,
        allowDeviceControl: settings.allowDeviceControl,
      };
      const result = await fetch(`${apiOrigin}/public/v1/admin/assistant`, {
            method: "PUT",
            headers: {
              "content-type": "application/json",
              ...authorizationHeaders(),
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(30_000),
          }).then(async (response) => {
            if (!response.ok) {
              const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
              throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
            }
            return response.json() as Promise<AssistantAdminResponse>;
          });
      applyResponse(result);
      if (draftToken.trim()) onAdminTokenChange(draftToken.trim());
      setSaved(true);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSaving(false);
    }
  }

  async function setFleetContribution(enabled: boolean) {
    const action = enabled ? "activate" : "pause";
    setFleetAction(action);
    setFleetError(null);
    setFleetResult(null);
    try {
      const result = await fetch(`${apiOrigin}/public/v1/admin/fleet-contribution`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...authorizationHeaders(),
            },
            body: JSON.stringify({ enabled }),
            signal: AbortSignal.timeout(30_000),
          }).then(async (response) => {
            if (!response.ok) {
              const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
              throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
            }
            return response.json() as Promise<FleetContributionCommandResponse>;
          });
      setFleet(result.status);
      setFleetResult(result);
      setFleetConfirmation(null);
      if (draftToken.trim()) onAdminTokenChange(draftToken.trim());
    } catch (caught) {
      setFleetError(errorText(caught));
    } finally {
      setFleetAction(null);
    }
  }

  const modelOptions = [
    { value: "", label: "Automatic · first available network model" },
    ...(runtime?.availableModels ?? []).map((model) => ({ value: model, label: model })),
  ];
  if (settings?.modelId && !modelOptions.some((option) => option.value === settings.modelId)) {
    modelOptions.push({ value: settings.modelId, label: `${settings.modelId} · currently offline` });
  }
  const confirmedFleetResults = fleetResult?.results.filter(
    (result) => result.state === "applied" || result.state === "unchanged",
  ).length ?? 0;
  const failedFleetResults = (fleetResult?.results.length ?? 0) - confirmedFleetResults;

  return (
    <section className="assistant-admin-page minimal-screen">
      <PageTitle
        eyebrow="NETWORK ADMINISTRATION"
        title="Network administration"
        copy="Control connected native nodes and the support assistant from one protected workspace."
        actions={<span className="assistant-network-only"><ShieldCheck size={15} /> Restricted controls</span>}
      />

      <UiCard className="assistant-admin-auth">
        <div className="assistant-admin-auth-copy">
          <ShieldCheck size={21} />
          <span><strong>Administrator authorization</strong><small>{authSession ? "Your signed-in network role is used first. A token can also be supplied if needed." : "Enter the network administrator token to read or change private network controls."}</small></span>
        </div>
        <div className="assistant-admin-auth-control">
          <UiInput
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draftToken}
            onChange={(event) => setDraftToken(event.target.value)}
            placeholder="Administrator token"
            aria-label="Network administrator token"
          />
          <UiButton type="button" disabled={loading || (!draftToken.trim() && !authSession)} onClick={() => void load(draftToken, true)}>
            {loading ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}Unlock
          </UiButton>
        </div>
      </UiCard>

      {error && <div className="assistant-admin-error" role="alert"><CircleAlert size={17} /><span>{error}</span></div>}

      {loading && !settings ? (
        <div className="assistant-admin-loading"><LoaderCircle className="spin" /><strong>Loading private network controls…</strong></div>
      ) : settings && runtime && fleet ? (
        <div className="assistant-admin-content">
          <UiCard className="fleet-control-card" aria-live="polite">
            <div className="fleet-control-heading">
              <div className="assistant-admin-section-icon"><Server size={21} /></div>
              <div>
                <span>DESKTOP CONTRIBUTION</span>
                <strong>Control every reachable node</strong>
                <small>Only computers with Mycellios open and the compatible control channel can acknowledge these commands.</small>
              </div>
              <UiButton
                type="button"
                className="fleet-refresh"
                disabled={fleetAction !== null}
                onClick={() => void requestFleetStatus().then(setFleet).catch((caught) => setFleetError(errorText(caught)))}
                aria-label="Refresh contribution status"
              >
                <RefreshCw size={16} />
              </UiButton>
            </div>

            <SummaryStrip label="Fleet status" items={[{ label: "Contributing", value: fleet.summary.contributing }, { label: "Paused", value: fleet.summary.paused }, { label: "Ready for commands", value: fleet.summary.controlReady }, { label: "Unavailable", value: fleet.summary.offline + fleet.summary.unsupported }]} />

            <div className="fleet-control-actions">
              <div>
                <strong>{fleet.summary.connected} of {fleet.summary.desktopNodes} native nodes connected</strong>
                <small>This controls Mycellios contribution, not the computer's physical power.</small>
              </div>
              <UiButton
                type="button"
                className="fleet-action fleet-action-pause"
                disabled={fleetAction !== null || fleet.summary.controlReady === 0}
                onClick={() => setFleetConfirmation("pause")}
              >
                <Pause size={17} />Pause all
              </UiButton>
              <UiButton
                type="button"
                className="fleet-action fleet-action-activate"
                disabled={fleetAction !== null || fleet.summary.controlReady === 0}
                onClick={() => setFleetConfirmation("activate")}
              >
                <CirclePower size={17} />Activate all
              </UiButton>
            </div>

            {fleetConfirmation && (
              <div className="fleet-confirmation" role="alert">
                <CircleAlert size={19} />
                <div>
                  <strong>{fleetConfirmation === "activate" ? "Activate" : "Pause"} {fleet.summary.controlReady} reachable nodes?</strong>
                  <small>{fleetConfirmation === "activate" ? "They will begin accepting compatible network work." : "Active work may be interrupted and no new work will be accepted."}</small>
                </div>
                <UiButton type="button" className="secondary" onClick={() => setFleetConfirmation(null)}>Cancel</UiButton>
                <UiButton
                  type="button"
                  className={fleetConfirmation === "activate" ? "confirm-activate" : "confirm-pause"}
                  disabled={fleetAction !== null}
                  onClick={() => void setFleetContribution(fleetConfirmation === "activate")}
                >
                  {fleetAction ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
                  Confirm
                </UiButton>
              </div>
            )}

            {fleetError && <div className="fleet-control-message error" role="alert"><CircleAlert size={16} />{fleetError}</div>}
            {fleetResult && (
              <div className={`fleet-control-message ${failedFleetResults > 0 ? "warning" : "success"}`}>
                {failedFleetResults > 0 ? <CircleAlert size={16} /> : <CheckCircle2 size={16} />}
                <span>
                  <strong>{confirmedFleetResults} of {fleetResult.results.length} nodes confirmed the command.</strong>
                  <small>{failedFleetResults > 0 ? `${failedFleetResults} did not acknowledge it; their state was not assumed.` : "Every targeted node reported its resulting state."}</small>
                </span>
              </div>
            )}
          </UiCard>

          <PanelDisclosure icon={Bot} title="Support assistant">
          <UiForm className="assistant-admin-form" onSubmit={(event) => void save(event)}>
          <div className="assistant-admin-status-grid">
            <UiCard>
              <span>PUBLIC STATUS</span>
              <strong className={runtime.available ? "healthy" : "offline"}><i />{!runtime.enabled ? "Disabled" : runtime.available ? "Online" : "Waiting for a model"}</strong>
              <small>The widget never falls back to an external AI.</small>
            </UiCard>
            <UiCard>
              <span>MODEL IN USE</span>
              <strong>{runtime.selectedModel ?? "None connected"}</strong>
              <small>{runtime.configuredModel ? "Fixed by the administrator" : "Selected automatically from live models"}</small>
            </UiCard>
            <UiCard>
              <span>LIVE OPTIONS</span>
              <strong>{runtime.availableModels.length}</strong>
              <small>Real non-test models announced by connected nodes.</small>
            </UiCard>
          </div>

          <UiCard className="assistant-admin-section assistant-admin-primary">
            <div className="assistant-admin-section-heading">
              <div className="assistant-admin-section-icon"><Bot size={21} /></div>
              <span><strong>Assistant availability and model</strong><small>Choose Automatic to keep support online when network capacity changes.</small></span>
            </div>
            <div className="assistant-admin-field-grid">
              <UiFieldLabel>
                <span>NETWORK MODEL</span>
                <AppSelect
                  ariaLabel="Support assistant network model"
                  value={settings.modelId ?? ""}
                  options={modelOptions}
                  onChange={(value) => update("modelId", value || null)}
                />
              </UiFieldLabel>
              <div className="assistant-admin-toggle-stack">
                <Toggle label="Show assistant publicly" checked={settings.enabled} onChange={(value) => update("enabled", value)} />
                <Toggle label="Offer confirmed device actions" checked={settings.allowDeviceControl} onChange={(value) => update("allowDeviceControl", value)} />
              </div>
            </div>
          </UiCard>

          <UiCard className="assistant-admin-section">
            <div className="assistant-admin-section-heading">
              <div className="assistant-admin-section-icon"><MessageSquareText size={21} /></div>
              <span><strong>Conversation</strong><small>These texts are visible to users. One suggested question per line, up to six.</small></span>
            </div>
            <UiFieldLabel className="assistant-admin-full-field">
              <span>WELCOME MESSAGE</span>
              <UiTextarea rows={3} value={settings.welcomeMessage} onChange={(event) => update("welcomeMessage", event.target.value)} />
            </UiFieldLabel>
            <UiFieldLabel className="assistant-admin-full-field">
              <span>SUGGESTED QUESTIONS</span>
              <UiTextarea rows={4} value={suggestionsText} onChange={(event) => { setSuggestionsText(event.target.value); setSaved(false); }} />
            </UiFieldLabel>
          </UiCard>

          <UiCard className="assistant-admin-section">
            <div className="assistant-admin-section-heading">
              <div className="assistant-admin-section-icon"><Sparkles size={21} /></div>
              <span><strong>Project knowledge and behaviour</strong><small>The coordinator adds verified live network data separately on every request.</small></span>
            </div>
            <UiFieldLabel className="assistant-admin-full-field">
              <span>PRIVATE SYSTEM INSTRUCTIONS</span>
              <UiTextarea className="assistant-admin-system-prompt" rows={12} value={settings.systemPrompt} onChange={(event) => update("systemPrompt", event.target.value)} />
              <small>Never place passwords or private tokens here. The instructions are sent only to the selected network model for each support request.</small>
            </UiFieldLabel>
            <div className="assistant-admin-number-grid">
              <UiFieldLabel><span>MAXIMUM OUTPUT TOKENS</span><UiInput type="number" min={64} max={4096} step={64} value={settings.maxOutputTokens} onChange={(event) => update("maxOutputTokens", Number(event.target.value))} /></UiFieldLabel>
              <UiFieldLabel><span>TEMPERATURE</span><UiInput type="number" min={0} max={1.5} step={0.1} value={settings.temperature} onChange={(event) => update("temperature", Number(event.target.value))} /></UiFieldLabel>
            </div>
          </UiCard>

          <div className="assistant-admin-savebar">
            <span><ShieldCheck size={15} />Shared model activation remains protected by administrator authorization.</span>
            {saved && <b><Check size={15} />Saved</b>}
            <UiButton type="submit" disabled={saving || settings.systemPrompt.trim().length < 20 || settings.welcomeMessage.trim().length < 10 || suggestionsText.trim().length < 3}>
              {saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{saving ? "Saving…" : "Save assistant"}
            </UiButton>
          </div>
          </UiForm>
          </PanelDisclosure>
        </div>
      ) : (
        <UiText className="assistant-admin-locked-copy">Unlock to manage devices and the support assistant.</UiText>
      )}
    </section>
  );
}

export function LiveNetworkTelemetry({ snapshot, evidence = overviewSnapshotEvidence(snapshot.capturedAt, null), showSnapshot = true }: { snapshot: PublicSnapshot; evidence?: OverviewSnapshotEvidence; showSnapshot?: boolean }) {
  const replicas = snapshot.models.reduce((total, model) => total + model.replicas, 0);
  const pipelines = snapshot.models.reduce((total, model) => total + model.pipelines, 0);
  const inflightJobs = snapshot.jobs.filter((job) => ["queued", "leasing", "running", "streaming"].includes(job.status));
  const runningJobs = inflightJobs.filter((job) => job.status === "running" || job.status === "streaming").length;
  const queuedJobs = inflightJobs.length - runningJobs;
  return (
    <section className={`live-network-telemetry${showSnapshot ? "" : " without-snapshot"}`} aria-label="Current live network data" aria-live="polite" data-period="current" data-evidence="coordinator-snapshot">
      {showSnapshot && <div className="snapshot" data-kpi="snapshot">
        <span><Radio size={12} />Snapshot</span>
        <strong className={evidence.state}><i />{evidence.label}</strong>
        <small>{evidence.detail}</small>
      </div>}
      <div data-kpi="connected-peers">
        <span><GitFork size={12} />Connected peers</span>
        <strong>{snapshot.summary.connected}</strong>
        <small>{snapshot.summary.online} online · {snapshot.summary.mobile} browser</small>
      </div>
      <div data-kpi="active-models">
        <span><Boxes size={12} />Active models</span>
        <strong>{snapshot.models.length}</strong>
        <small>{replicas} replicas · {pipelines} pipelines</small>
      </div>
      <div className="inflight" data-kpi="inflight-jobs">
        <span><Activity size={12} />Inflight</span>
        <strong>{inflightJobs.length}</strong>
        <small>{runningJobs} running · {queuedJobs} queued</small>
        <i className={inflightJobs.length > 0 ? "active" : ""} />
      </div>
    </section>
  );
}

const historyRangeLabels: Record<NetworkHistoryRange, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
};

export function NetworkHistory({ endpoint, compact = true }: { endpoint: string; compact?: boolean }) {
  const [range, setRange] = useState<NetworkHistoryRange>("24h");
  const [history, setHistory] = useState<NetworkTelemetryHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async (silent = false) => {
    const requestId = ++requestSeq.current;
    if (!silent) { setHistory(null); setLoading(true); setLoadError(null); }
    try {
      const separator = endpoint.includes("?") ? "&" : "?";
      const response = await fetch(`${endpoint}${separator}range=${range}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = await response.json() as NetworkTelemetryHistory;
      if (requestId === requestSeq.current) { setHistory(next); setLoadError(null); }
    } catch (caught) {
      if (requestId === requestSeq.current) setLoadError(errorText(caught));
    } finally {
      if (!silent && requestId === requestSeq.current) setLoading(false);
    }
  }, [endpoint, range]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 60_000);
    return () => { requestSeq.current += 1; window.clearInterval(timer); };
  }, [load]);

  return <section className="network-history-page minimal-screen">
    <PageTitle title="Network history" />
    <div className="network-history-toolbar">
      <div className="network-history-ranges" role="group" aria-label="History range">
        {(Object.keys(historyRangeLabels) as NetworkHistoryRange[]).map((value) => (
          <UiButton
            type="button"
            className={range === value ? "active" : ""}
            aria-pressed={range === value}
            onClick={() => setRange(value)}
            key={value}
          >{historyRangeLabels[value]}</UiButton>
        ))}
      </div>
      <span>{history?.samples.length ? `${history.samples.length} samples` : ""}</span>
    </div>
    {loadError && <div className="network-history-error" role="alert"><CircleAlert size={17} /><span><strong>Could not load history</strong>{loadError}</span><UiButton type="button" onClick={() => void load()}>Retry</UiButton></div>}
    {loading && !history ? <div className="network-history-loading"><LoaderCircle className="spin" /><span>Loading saved samples…</span></div> : history && <NetworkHistoryReport history={history} compact={compact} />}
  </section>;
}

export function NetworkHistoryReport({ history, compact = true }: { history: NetworkTelemetryHistory; compact?: boolean }) {
  const latest = history.samples.at(-1);
  const first = history.samples[0];
  if (!latest) {
    return <Empty icon={History} title="No samples yet" copy="The coordinator will save the first reading automatically and add another every ten minutes." />;
  }
  return <>
    {!compact && <div className="network-history-summary" aria-label="Latest sample">
      <HistorySummaryCard
        icon={MemoryStick}
        label="Active VRAM"
        value={formatMemory(latest.offeredVramMb)}
        detail={`${formatMemory(latest.freeVramMb)} free now`}
        delta={historyDelta(latest.offeredVramMb, first?.offeredVramMb)}
        tone="blue"
      />
      <HistorySummaryCard
        icon={Server}
        label="Connected nodes"
        value={String(latest.connectedNodes)}
        detail={`${latest.onlineNodes} online · ${latest.browserNodes} browser`}
        delta={historyDelta(latest.connectedNodes, first?.connectedNodes)}
        tone="green"
      />
      {!compact && <HistorySummaryCard
        icon={Boxes}
        label="Active models"
        value={String(latest.activeModels)}
        detail={`${latest.modelReplicas} replicas · ${latest.modelPipelines} pipelines`}
        delta={historyDelta(latest.activeModels, first?.activeModels)}
        tone="purple"
      />}
      {!compact && <HistorySummaryCard
        icon={Activity}
        label="Jobs in flight"
        value={String(latest.inflightJobs)}
        detail={`${latest.runningJobs} running`}
        delta={historyDelta(latest.inflightJobs, first?.inflightJobs)}
        tone="orange"
      />}
    </div>}
    <div className="network-history-meta"><span>Updated {formatHistoryDate(latest.capturedAt)}</span></div>
    <div className="network-history-charts">
      <NetworkHistoryChart
        title="Network capacity"
        eyebrow="ACTIVE VRAM"
        samples={history.samples}
        unit=""
        valueFormatter={formatMemory}
        series={[
          { key: "offeredVramMb", label: "Active total", tone: "blue" },
          { key: "freeVramMb", label: "Free", tone: "green" },
        ]}
      />
      <NetworkHistoryChart
        title="Node availability"
        eyebrow="PEERS"
        samples={history.samples}
        unit="nodes"
        valueFormatter={(value) => String(Math.round(value))}
        series={[
          { key: "connectedNodes", label: "Connected", tone: "blue" },
          { key: "onlineNodes", label: "Online", tone: "green" },
          { key: "browserNodes", label: "Browser", tone: "purple" },
        ]}
      />
      {!compact && <DetailedHistoryCharts history={history} />}
    </div>
    {compact ? (
      <PanelDisclosure icon={Activity} eyebrow="ON DEMAND" title="More charts & saved readings">
        <div className="network-history-charts network-history-charts-detail"><DetailedHistoryCharts history={history} /></div>
        <NetworkHistoryTable samples={history.samples} />
      </PanelDisclosure>
    ) : <NetworkHistoryTable samples={history.samples} />}
  </>;
}

function DetailedHistoryCharts({ history }: { history: NetworkTelemetryHistory }) {
  return <>
    <NetworkHistoryChart
      title="Available models"
      eyebrow="MODEL FABRIC"
      samples={history.samples}
      unit="models"
      valueFormatter={(value) => String(Math.round(value))}
      series={[
        { key: "activeModels", label: "Models", tone: "purple" },
        { key: "modelReplicas", label: "Replicas", tone: "blue" },
        { key: "modelPipelines", label: "Pipelines", tone: "green" },
      ]}
    />
    <NetworkHistoryChart
      title="Inference load"
      eyebrow="ACTIVITY"
      samples={history.samples}
      unit="jobs"
      valueFormatter={(value) => String(Math.round(value))}
      series={[
        { key: "inflightJobs", label: "In flight", tone: "orange" },
        { key: "runningJobs", label: "Running", tone: "green" },
      ]}
    />
  </>;
}

type HistoryMetricKey =
  | "offeredVramMb"
  | "freeVramMb"
  | "connectedNodes"
  | "onlineNodes"
  | "browserNodes"
  | "activeModels"
  | "modelReplicas"
  | "modelPipelines"
  | "inflightJobs"
  | "runningJobs";

interface HistoryChartSeries {
  key: HistoryMetricKey;
  label: string;
  tone: "blue" | "green" | "purple" | "orange";
}

function NetworkHistoryChart({
  title,
  eyebrow,
  samples,
  series,
  unit,
  valueFormatter,
}: {
  title: string;
  eyebrow: string;
  samples: NetworkTelemetrySample[];
  series: HistoryChartSeries[];
  unit: string;
  valueFormatter: (value: number) => string;
}) {
  const points = downsampleNetworkHistory(samples, 720);
  const width = 760;
  const height = 250;
  const left = 88;
  const right = 24;
  const top = 24;
  const bottom = 44;
  const ceiling = Math.max(
    1,
    ...points.flatMap((sample) => series.map(({ key }) => sample[key])),
  );
  const x = (index: number) => points.length === 1
    ? (left + width - right) / 2
    : left + (index / Math.max(points.length - 1, 1)) * (width - left - right);
  const y = (value: number) => top + (1 - value / ceiling) * (height - top - bottom);
  const labelEvery = Math.max(1, Math.ceil(points.length / 3));
  return <UiCard className="network-history-chart">
    <header><div><UiHeading as="h2">{title}</UiHeading></div><div className="network-history-legend">{series.map((item) => <span className={item.tone} key={item.key}><i />{item.label}</span>)}</div></header>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}. ${samples.length} real samples.`}>
      {[0, 0.5, 1].map((ratio) => <g key={ratio}>
        <line className="history-grid-line" x1={left} y1={top + ratio * (height - top - bottom)} x2={width - right} y2={top + ratio * (height - top - bottom)} />
        <text x={left - 8} y={top + ratio * (height - top - bottom) + 4} textAnchor="end">{valueFormatter(ceiling * (1 - ratio))}</text>
      </g>)}
      {series.map((item) => <g className={`network-history-series ${item.tone}`} key={item.key}>
        {points.length > 1 && <polyline points={points.map((sample, index) => `${x(index)},${y(sample[item.key])}`).join(" ")} />}
        {points.length === 1 && <circle cx={x(0)} cy={y(points[0]![item.key])} r="5"><title>{`${item.label}: ${valueFormatter(points[0]![item.key])}`}</title></circle>}
      </g>)}
      {points.map((sample, index) => {
        if (index % labelEvery !== 0 && index !== points.length - 1) return null;
        return <text className={`history-x-label${index === 0 || index === points.length - 1 ? " history-edge-label" : ""}`} x={x(index)} y={height - 13} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} key={sample.capturedAt}>{formatHistoryChartTime(sample.capturedAt)}</text>;
      })}
    </svg>
    <footer>{series.map((item) => <strong key={item.key}>{item.label} {valueFormatter(points.at(-1)?.[item.key] ?? 0)} {unit && <small>{unit}</small>}</strong>)}</footer>
  </UiCard>;
}

function HistorySummaryCard({
  icon: Icon,
  label,
  value,
  detail,
  delta,
  tone,
}: {
  icon: typeof Network;
  label: string;
  value: string;
  detail: string;
  delta: number;
  tone: "blue" | "green" | "purple" | "orange";
}) {
  return <UiCard className={`network-history-summary-card ${tone}`}>
    <Icon />
    <span><small>{label}</small><strong>{value}</strong><em>{detail}</em></span>
    <b className={delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral"}>{delta > 0 ? "+" : ""}{delta} since start</b>
  </UiCard>;
}

function NetworkHistoryTable({ samples }: { samples: NetworkTelemetrySample[] }) {
  const [page, setPage] = useState(0);
  const allRows = samples.slice(-24).reverse();
  const pageSize = TABLE_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(allRows.length / pageSize));
  const visiblePage = Math.min(page, pageCount - 1);
  const visible = allRows.slice(visiblePage * pageSize, visiblePage * pageSize + pageSize);
  useEffect(() => setPage(0), [samples]);
  return <UiCard className="network-history-table-card">
    <header><div><span>EXACT SAMPLES</span><UiHeading as="h2">Latest saved readings</UiHeading></div><small>Showing {allRows.length} most recent</small></header>
    <UiText className="panel-table-scroll-hint">Swipe sideways to see every reading →</UiText>
    <div className="network-history-table-scroll" role="region" aria-label="Scrollable history readings" tabIndex={0}>
      <UiTable>
        <UiTableHead><UiTableRow><UiTableHeader>Timestamp</UiTableHeader><UiTableHeader>Active VRAM</UiTableHeader><UiTableHeader>Free VRAM</UiTableHeader><UiTableHeader>Nodes</UiTableHeader><UiTableHeader>Online</UiTableHeader><UiTableHeader>Models</UiTableHeader><UiTableHeader>Inflight</UiTableHeader><UiTableHeader>Completed</UiTableHeader></UiTableRow></UiTableHead>
        <UiTableBody>{visible.map((sample) => <UiTableRow key={sample.capturedAt}>
          <UiTableCell><strong>{formatHistoryDate(sample.capturedAt)}</strong></UiTableCell>
          <UiTableCell>{formatMemory(sample.offeredVramMb)}</UiTableCell>
          <UiTableCell>{formatMemory(sample.freeVramMb)}</UiTableCell>
          <UiTableCell>{sample.connectedNodes}</UiTableCell>
          <UiTableCell>{sample.onlineNodes}</UiTableCell>
          <UiTableCell>{sample.activeModels}</UiTableCell>
          <UiTableCell>{sample.inflightJobs}</UiTableCell>
          <UiTableCell>{sample.completedJobs}</UiTableCell>
        </UiTableRow>)}</UiTableBody>
      </UiTable>
    </div>
    {allRows.length > pageSize && <TablePagination label="history samples" page={visiblePage} pageCount={pageCount} total={allRows.length} onPageChange={setPage} />}
  </UiCard>;
}

function downsampleNetworkHistory(
  samples: NetworkTelemetrySample[],
  maximum: number,
): NetworkTelemetrySample[] {
  if (samples.length <= maximum) return samples;
  const indexes = new Set<number>([0, samples.length - 1]);
  const step = (samples.length - 1) / (maximum - 1);
  for (let index = 1; index < maximum - 1; index += 1) {
    indexes.add(Math.round(index * step));
  }
  return [...indexes].sort((left, right) => left - right).map((index) => samples[index]!);
}

function historyDelta(current: number, initial: number | undefined): number {
  return initial === undefined ? 0 : Math.round(current - initial);
}

function formatHistoryDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatHistoryChartTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value)).replace(",", "");
}

export function DashboardConnect({
  apiBaseUrl,
  earnUrl,
  downloadsUrl,
  browserUrl,
  external,
  onOpenEarn,
}: {
  apiBaseUrl: string;
  earnUrl: string;
  downloadsUrl: string;
  browserUrl: string;
  external: boolean;
  onOpenEarn: () => void;
}) {
  const titleId = useId();
  const [copied, setCopied] = useState<"api" | "link" | null>(null);
  const [copyError, setCopyError] = useState<"api" | "link" | null>(null);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const externalProps = external ? { target: "_blank", rel: "noreferrer" } as const : {};

  useEffect(() => () => {
    if (resetRef.current) clearTimeout(resetRef.current);
  }, []);

  async function copyValue(kind: "api" | "link", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setCopyError(null);
    } catch {
      setCopied(null);
      setCopyError(kind);
    }
    if (resetRef.current) clearTimeout(resetRef.current);
    resetRef.current = setTimeout(() => {
      setCopied(null);
      setCopyError(null);
    }, 2200);
  }

  const copyLabel = (kind: "api" | "link") => copied === kind ? "Copied" : copyError === kind ? "Try again" : "Copy";

  return (
    <UiCard className="dashboard-connect" aria-labelledby={titleId}>
      <header>
        <div><strong id={titleId}>Connect</strong></div>
        <UiLink href="https://github.com/tych0s/mycellios#readme" target="_blank" rel="noreferrer">Full docs <ArrowRight size={13} /></UiLink>
      </header>
      <div className="dashboard-connect-grid">
        <section>
          <span>1 · NATIVE PACKAGES</span>
          <UiLink className="dashboard-connect-field install" href={downloadsUrl} {...externalProps}>
            <Download size={15} />
            <code>Check native packages</code>
            <b>open</b>
          </UiLink>
        </section>
        <section>
          <span>API ENDPOINT</span>
          <div className="dashboard-connect-field endpoint">
            <Globe2 size={15} />
            <code>{apiBaseUrl}</code>
            <UiButton type="button" onClick={() => void copyValue("api", apiBaseUrl)} aria-label={`${copyLabel("api")} API endpoint`}>
              {copied === "api" ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied === "api" ? "copied" : "configured target"}</span>
            </UiButton>
          </div>
        </section>
        <section className="dashboard-connect-join">
          <span>2 · CONNECT</span>
          <div className="dashboard-connect-command">
            <code>{earnUrl}</code>
            <UiButton type="button" className={copyError === "link" ? "error" : copied === "link" ? "copied" : ""} onClick={() => void copyValue("link", earnUrl)}>
              {copied === "link" ? <Check size={14} /> : <Copy size={14} />}
              {copyLabel("link")}
            </UiButton>
          </div>
          <UiText>Open the Earn link to choose how this device connects. Native packages are listed when published. The configured API uses the OpenAI-compatible <code>/v1</code> interface.</UiText>
        </section>
      </div>
      <footer>
        <UiLink href={browserUrl} {...externalProps}><Smartphone size={14} />Start a browser node <ExternalLink size={12} /></UiLink>
        <UiButton type="button" onClick={onOpenEarn}>View every option <ChevronRight size={13} /></UiButton>
      </footer>
    </UiCard>
  );
}

export interface OverviewSnapshotEvidence {
  state: "waiting" | "fresh" | "delayed" | "stale" | "degraded";
  label: string;
  detail: string;
  capturedAt: string | null;
  ageMs: number | null;
}

export function overviewSnapshotEvidence(
  capturedAt: string,
  connectionError: string | null,
  now = Date.now(),
): OverviewSnapshotEvidence {
  const captured = Date.parse(capturedAt);
  if (!Number.isFinite(captured) || capturedAt === EMPTY.capturedAt) {
    return {
      state: "waiting",
      label: "WAITING FOR EVIDENCE",
      detail: connectionError ? "Coordinator unavailable; no verified snapshot received" : "No verified snapshot received yet",
      capturedAt: null,
      ageMs: null,
    };
  }
  const ageMs = Math.max(0, now - captured);
  if (connectionError) {
    return { state: "degraded", label: "LAST VERIFIED", detail: `Coordinator unavailable · captured ${relativeTime(capturedAt, now)}`, capturedAt, ageMs };
  }
  if (ageMs <= 10_000) return { state: "fresh", label: "LIVE SNAPSHOT", detail: `Captured ${relativeTime(capturedAt, now)}`, capturedAt, ageMs };
  if (ageMs <= 30_000) return { state: "delayed", label: "DELAYED SNAPSHOT", detail: `Captured ${relativeTime(capturedAt, now)}`, capturedAt, ageMs };
  return { state: "stale", label: "STALE SNAPSHOT", detail: `Captured ${relativeTime(capturedAt, now)}`, capturedAt, ageMs };
}

export function Overview({ snapshot, connectionError, onNavigate, publicLink, external, apiBaseUrl, earnUrl, developerMode, theme }: { snapshot: PublicSnapshot; connectionError: string | null; onNavigate: (view: PanelView) => void; publicLink: (path: string) => string; external: boolean; apiBaseUrl: string; earnUrl: string; developerMode: boolean; theme: "dark" | "light" }) {
  const evidence = overviewSnapshotEvidence(snapshot.capturedAt, connectionError);
  const active = snapshot.workers.filter((worker) => worker.connected);
  const operational = active.filter((worker) => worker.status === "online");
  const activeGpus = operational.flatMap((worker) => worker.gpus);
  const activeDeployments = operational.flatMap((worker) => worker.deployments);
  const telemetryGpus = activeGpus.filter((gpu) => gpu.utilizationPct !== undefined);
  const poweredGpus = activeGpus.filter((gpu) => (gpu.powerW ?? 0) > 0);
  const sharedMemory = activeGpus.reduce((total, gpu) => total + gpu.offeredVramMb, 0);
  const freeMemory = Math.min(sharedMemory, activeGpus.reduce((total, gpu) => total + gpu.freeOfferedVramMb, 0));
  const measured = activeDeployments.filter(isMeasuredDeployment);
  const throughput = measured.reduce((total, deployment) => total + deployment.tokensPerSecond, 0);
  const execution = summarizeDeploymentExecution(activeDeployments);
  const inflight = snapshot.jobs.filter((job) => ["queued", "leasing", "running", "streaming"].includes(job.status)).length;
  return <section className="overview-page overview-minimal">
    <header className="overview-heading">
      <div><UiHeading as="h1">Overview</UiHeading><span className={`overview-status ${evidence.state}`} role="status" title={evidence.detail}><i />{evidence.state === "fresh" ? "Live network" : evidence.state === "waiting" ? "Waiting for data" : evidence.detail}</span></div>
      <div className="overview-actions"><UiButton variant="primary" onClick={() => onNavigate("contribute")}>Add a device <ArrowRight size={15} /></UiButton></div>
    </header>
    {evidence.state === "waiting" ? <UiCard className="overview-no-evidence"><CircleAlert /><div><UiHeading as="h2">Waiting for the coordinator</UiHeading><UiText>Network data will appear when the connection is restored.</UiText></div></UiCard> : <>
      <dl className="overview-summary" aria-label="Network summary">
        <div><dt>Connected nodes</dt><dd>{snapshot.summary.connected}</dd></div>
        <div><dt>Available models</dt><dd>{snapshot.models.length}</dd></div>
        <div><dt>Shared memory</dt><dd>{formatMemory(sharedMemory)}</dd></div>
        <div><dt>Tasks in progress</dt><dd>{inflight}</dd></div>
      </dl>
      <NetworkModelCatalog snapshot={snapshot} developerMode={developerMode} theme={theme} onNavigate={onNavigate} compact />
      <section className="overview-details" aria-label="Network details">
        <UiHeading as="h2">Details</UiHeading>
        <OverviewDetail title="Devices & network" icon={Network}>
          <ConnectedPeersTable workers={snapshot.workers} />
          <InteractiveMesh workers={active} traces={snapshot.recentNetworkTraces ?? []} registeredWorkers={snapshot.summary.registered} sharedVramMb={sharedMemory} publicLink={publicLink} external={external} developerMode={developerMode} onNavigate={onNavigate} />
        </OverviewDetail>
        <OverviewDetail title="Models & performance" icon={Cpu}>
          <div className="overview-runtime">
            <ExecutionBadge execution={execution} workers={snapshot.workers} />
            <dl><div><dt>Free memory</dt><dd>{formatMemory(freeMemory)}</dd></div><div><dt>Memory in use</dt><dd>{formatMemory(Math.max(0, sharedMemory - freeMemory))}</dd></div><div><dt>Runtime stages</dt><dd>{execution.verified ? execution.unitCount : "Unverified"}</dd></div><div><dt>Measured speed</dt><dd>{throughput > 0 ? `${formatCompactNumber(throughput)} tok/s` : "Not measured"}</dd></div>{developerMode && <><div><dt>Average GPU load</dt><dd>{telemetryGpus.length > 0 ? `${(telemetryGpus.reduce((sum, gpu) => sum + (gpu.utilizationPct ?? 0), 0) / telemetryGpus.length).toFixed(0)}%` : "No telemetry"}</dd></div><div><dt>Observed GPU draw</dt><dd>{poweredGpus.length > 0 ? formatPower(poweredGpus.reduce((sum, gpu) => sum + (gpu.powerW ?? 0), 0)) : "No telemetry"}</dd></div></>}</dl>
          </div>
          <NetworkModelCatalog snapshot={snapshot} developerMode={developerMode} theme={theme} onNavigate={onNavigate} />
        </OverviewDetail>
        <OverviewDetail title="API & connection" icon={Code2}>
          <DashboardConnect apiBaseUrl={apiBaseUrl} earnUrl={earnUrl} downloadsUrl={publicLink("/downloads")} browserUrl={publicLink("/browser/?autostart=1")} external={external} onOpenEarn={() => window.location.assign("/earn")} />
        </OverviewDetail>
        <OverviewDetail title="Recent activity" icon={History}>
          <div className="overview-activity-heading"><span>{formatCompactNumber(snapshot.summary.completedJobs)} tasks completed</span>{developerMode && <UiButton onClick={() => onNavigate("jobs")}>View all <ArrowRight size={14} /></UiButton>}</div>
          <div className="activity-list">
            {snapshot.jobs.slice(0, 5).map((job) => <div key={job.id}><i className={job.status} /><div><strong>{job.model}</strong><span>{relativeTime(job.updatedAt)}</span></div><b>{job.status}</b></div>)}
            {snapshot.jobs.length === 0 && <UiText>No recent tasks.</UiText>}
          </div>
        </OverviewDetail>
      </section>
    </>}
  </section>;
}

function OverviewDetail({ title, icon: Icon, children }: { title: string; icon: typeof Network; children: ReactNode }) {
  return <UiDisclosure className="overview-detail">
    <UiDisclosureSummary><Icon size={17} aria-hidden="true" /><span>{title}</span><ChevronDown size={16} aria-hidden="true" /></UiDisclosureSummary>
    <div className="overview-detail-content">{children}</div>
  </UiDisclosure>;
}

type PeerSortKey = "id" | "hosted" | "version" | "vram" | "share" | "seen" | "role" | "status";
type PeerFilter = "all" | "serving" | "connected" | "offline";

interface ConnectedPeerRow {
  worker: PublicWorker;
  hosted: string;
  hostedCount: number;
  version: string;
  vramMb: number;
  sharePercent: number;
  seenAt: number;
  role: "Host" | "Worker" | "Browser";
  status: "serving" | "connected" | "attention" | "offline";
}

function workerPeerStatus(worker: PublicWorker): ConnectedPeerRow["status"] {
  if (!worker.connected || worker.status === "offline") return "offline";
  if (worker.status === "suspect" || worker.status === "draining") return "attention";
  return worker.deployments.length > 0 ? "serving" : "connected";
}

function workerPeerRole(worker: PublicWorker): ConnectedPeerRow["role"] {
  return worker.kind === "cell" ? "Host" : worker.kind === "browser" ? "Browser" : "Worker";
}

function ConnectedPeersTable({ workers }: { workers: PublicWorker[] }) {
  const pageSize = TABLE_PAGE_SIZE;
  const [filter, setFilter] = useState<PeerFilter>("all");
  const [sortKey, setSortKey] = useState<PeerSortKey>("status");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const connectedVramMb = workers.filter((worker) => worker.connected).reduce((total, worker) => total + worker.offeredVramMb, 0);
  const rows = useMemo<ConnectedPeerRow[]>(() => workers.map((worker) => {
    const models = [...new Set(worker.deployments.map((deployment) => deployment.model))];
    return {
      worker,
      hosted: models[0] ?? "—",
      hostedCount: models.length,
      version: worker.agentVersion ? `v${worker.agentVersion}` : "Legacy",
      vramMb: worker.offeredVramMb,
      sharePercent: connectedVramMb > 0 && worker.connected ? worker.offeredVramMb / connectedVramMb * 100 : 0,
      seenAt: Date.parse(worker.lastSeenAt) || 0,
      role: workerPeerRole(worker),
      status: workerPeerStatus(worker),
    };
  }), [connectedVramMb, workers]);
  const filteredRows = useMemo(() => {
    const filtered = rows.filter((row) => filter === "all"
      || filter === "serving" && row.status === "serving"
      || filter === "connected" && row.status === "connected"
      || filter === "offline" && (row.status === "offline" || row.status === "attention"));
    return filtered.sort((left, right) => {
      const leftValue = peerSortValue(left, sortKey);
      const rightValue = peerSortValue(right, sortKey);
      const comparison = typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue));
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [filter, rows, sortDirection, sortKey]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const visiblePage = Math.min(page, pageCount - 1);
  const visibleRows = filteredRows.slice(visiblePage * pageSize, visiblePage * pageSize + pageSize);
  const rangeStart = filteredRows.length === 0 ? 0 : visiblePage * pageSize + 1;
  const rangeEnd = Math.min(filteredRows.length, (visiblePage + 1) * pageSize);

  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  function toggleSort(nextKey: PeerSortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
    } else {
      setSortKey(nextKey);
      setSortDirection("asc");
    }
    setPage(0);
  }

  const sortableHeader = (label: string, key: PeerSortKey) => (
    <UiButton type="button" className={sortKey === key ? `active ${sortDirection}` : ""} onClick={() => toggleSort(key)}>
      {label}<ChevronDown size={11} />
    </UiButton>
  );

  return (
    <UiCard className="connected-peers-card" aria-labelledby="connected-peers-title">
      <header>
        <strong id="connected-peers-title">Registered peers</strong>
        <div className="connected-peers-controls">
          <span>{filteredRows.length} total</span>
          <UiFieldLabel><SlidersHorizontal size={12} /><span>Filter</span><UiSelect aria-label="Filter peers" value={filter} onChange={(event) => { setFilter(event.target.value as PeerFilter); setPage(0); }}><option value="all">All peers</option><option value="serving">Serving</option><option value="connected">Connected</option><option value="offline">Needs attention</option></UiSelect></UiFieldLabel>
        </div>
      </header>
      <UiText className="panel-table-scroll-hint">Swipe sideways to see all peer details →</UiText>
      <div className="connected-peers-scroll" role="region" aria-label="Scrollable peer details" tabIndex={0}>
        <UiTable>
          <UiTableHead><UiTableRow>
            <UiTableHeader aria-sort={sortKey === "id" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>{sortableHeader("ID", "id")}</UiTableHeader>
            <UiTableHeader aria-sort={sortKey === "hosted" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>{sortableHeader("Hosted", "hosted")}</UiTableHeader>
            <UiTableHeader aria-sort={sortKey === "version" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>{sortableHeader("Version", "version")}</UiTableHeader>
            <UiTableHeader aria-sort={sortKey === "vram" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>{sortableHeader("VRAM", "vram")}</UiTableHeader>
            <UiTableHeader aria-sort={sortKey === "share" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>{sortableHeader("Share", "share")}</UiTableHeader>
            <UiTableHeader aria-sort={sortKey === "seen" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>{sortableHeader("Last seen", "seen")}</UiTableHeader>
            <UiTableHeader aria-sort={sortKey === "role" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>{sortableHeader("Role", "role")}</UiTableHeader>
            <UiTableHeader aria-sort={sortKey === "status" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>{sortableHeader("Status", "status")}</UiTableHeader>
          </UiTableRow></UiTableHead>
          <UiTableBody>
            {visibleRows.map((row) => (
              <UiTableRow key={row.worker.id}>
                <UiTableCell><strong>{shortId(row.worker.id)}</strong><small>{workerLabel(row.worker)}</small></UiTableCell>
                <UiTableCell><code>{row.hosted}</code>{row.hostedCount > 1 && <small>+{row.hostedCount - 1} more</small>}</UiTableCell>
                <UiTableCell><code>{row.version}</code></UiTableCell>
                <UiTableCell><strong>{formatMemory(row.vramMb)}</strong></UiTableCell>
                <UiTableCell><div className="peer-share"><i><b style={{ width: `${Math.min(100, row.sharePercent)}%` }} /></i><span>{Math.round(row.sharePercent)}%</span></div></UiTableCell>
                <UiTableCell><code>{relativeTime(row.worker.lastSeenAt)}</code></UiTableCell>
                <UiTableCell><span className={`peer-role ${row.role.toLowerCase()}`}>{row.role}</span></UiTableCell>
                <UiTableCell><UiBadge className={`peer-state ${row.status}`}><i />{peerStatusLabel(row.status)}</UiBadge></UiTableCell>
              </UiTableRow>
            ))}
            {visibleRows.length === 0 && <UiTableRow><UiTableCell className="connected-peers-empty" colSpan={8}><Server size={18} /><span><strong>No peers in this view</strong><small>Change the filter or connect a new device.</small></span></UiTableCell></UiTableRow>}
          </UiTableBody>
        </UiTable>
      </div>
      {filteredRows.length > pageSize && <TablePagination label="peers" page={visiblePage} pageCount={pageCount} total={filteredRows.length} onPageChange={setPage} />}
    </UiCard>
  );
}

function peerSortValue(row: ConnectedPeerRow, key: PeerSortKey): string | number {
  switch (key) {
    case "id": return row.worker.id;
    case "hosted": return row.hosted;
    case "version": return row.version;
    case "vram": return row.vramMb;
    case "share": return row.sharePercent;
    case "seen": return row.seenAt;
    case "role": return row.role;
    case "status": return { serving: 0, connected: 1, attention: 2, offline: 3 }[row.status];
  }
}

function peerStatusLabel(status: ConnectedPeerRow["status"]): string {
  if (status === "serving") return "Serving";
  if (status === "connected") return "Connected";
  if (status === "attention") return "Attention";
  return "Offline";
}

interface NetworkCatalogEntry {
  id: string;
  state: "active" | "queued";
  replicas: number;
  pipelines: number;
  request: RequestedModelCapacity | null;
}

function NetworkModelCatalog({ snapshot, developerMode, theme, onNavigate, compact = false }: {
  compact?: boolean;
  snapshot: PublicSnapshot;
  developerMode: boolean;
  theme: "light" | "dark";
  onNavigate: (view: PanelView) => void;
}) {
  const [selectedModelId, setSelectedModelId] = useState("");
  const [page, setPage] = useState(0);
  const closeSelectedModel = useCallback(() => setSelectedModelId(""), []);
  const drawerTitleId = useId();
  const [showAll, setShowAll] = useState(false);
  const entries = useMemo<NetworkCatalogEntry[]>(() => {
    const active = snapshot.models.map((model) => ({
      id: model.id,
      state: "active" as const,
      replicas: model.replicas,
      pipelines: model.pipelines,
      request: snapshot.requestedModels.find((request) => request.id === model.id) ?? null,
    }));
    const activeIds = new Set(active.map((model) => model.id.toLowerCase()));
    const queued = snapshot.requestedModels
      .filter((request) => !activeIds.has(request.id.toLowerCase()))
      .map((request) => ({
        id: request.id,
        state: "queued" as const,
        replicas: 0,
        pipelines: 0,
        request,
      }));
    return [...active, ...queued];
  }, [snapshot.models, snapshot.requestedModels]);
  const selectedEntry = entries.find((entry) => entry.id === selectedModelId) ?? null;
  const pageSize = TABLE_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const visiblePage = Math.min(page, pageCount - 1);
  const visibleEntries = entries.slice(visiblePage * pageSize, visiblePage * pageSize + pageSize);
  useEffect(() => setPage(0), [entries]);

  const activeEntries = entries.filter((entry) => entry.state === "active").sort((left, right) => left.id.localeCompare(right.id));
  const compactEntries = showAll ? activeEntries : activeEntries.slice(0, 5);
  return <>
    {compact ? <UiCard className="overview-models">
      <header><UiHeading as="h2">Models</UiHeading>{developerMode && <UiButton onClick={() => onNavigate("models")}>Manage models</UiButton>}</header>
      {compactEntries.length > 0 ? <ul className="overview-model-list">{compactEntries.map((entry) => {
        const telemetry = networkModelTelemetry(snapshot, entry.id);
        const runtime = networkModelRuntimeLabel(telemetry.deployments);
        const capability = runtime === "kokoro" ? "Speech" : runtime === "embedding" ? "Embeddings" : runtime === "decision" ? "Decisions" : runtime;
        return <li key={entry.id}><UiButton className="overview-model-row" onClick={() => setSelectedModelId(entry.id)} aria-label={`View details for ${entry.id}`}>
          <Boxes size={19} aria-hidden="true" /><span><strong>{entry.id}</strong><small>{capability}</small></span><span className="overview-model-nodes">{telemetry.peers.length} {telemetry.peers.length === 1 ? "node" : "nodes"}</span><ChevronRight size={16} aria-hidden="true" />
        </UiButton></li>;
      })}</ul> : <div className="overview-models-empty"><Boxes size={24} /><strong>No models available yet</strong><UiText>Add a device to bring a model online.</UiText></div>}
      {activeEntries.length > 5 && <footer><UiButton onClick={() => setShowAll((current) => !current)} aria-expanded={showAll}>{showAll ? "Show less" : `Show all ${activeEntries.length} models`}</UiButton></footer>}
    </UiCard> : <UiCard className="network-model-catalog">
      <header className="network-model-catalog-head">
        <div><span>MODEL & TOKEN CATALOG</span><UiHeading as="h2">Available intelligence</UiHeading><UiText>Inspect each model, its real token activity and the peers currently serving it.</UiText></div>
        <div><b><i /> LIVE DATA</b>{developerMode && <UiButton type="button" onClick={() => onNavigate("models")}>Manage models</UiButton>}</div>
      </header>
      <UiText className="panel-table-scroll-hint">Swipe sideways to see all model details →</UiText>
      <div className="network-model-table-wrap" role="region" aria-label="Scrollable model details" tabIndex={0}>
        <UiTable className="network-model-table">
          <UiTableHead><UiTableRow><UiTableHeader>Model</UiTableHeader><UiTableHeader>Status</UiTableHeader><UiTableHeader>Availability</UiTableHeader><UiTableHeader>Peer memory</UiTableHeader><UiTableHeader>Measured speed</UiTableHeader><UiTableHeader>Processed tokens</UiTableHeader><UiTableHeader><span className="sr-only">Details</span></UiTableHeader></UiTableRow></UiTableHead>
          <UiTableBody>{visibleEntries.map((entry) => {
            const telemetry = networkModelTelemetry(snapshot, entry.id);
            return <UiTableRow key={entry.id} className={selectedModelId === entry.id ? "selected" : ""}>
              <UiTableCell><UiButton type="button" className="network-model-name" onClick={() => setSelectedModelId(entry.id)}><i><Boxes /></i><span><strong>{entry.id}</strong><small>{networkModelRuntimeLabel(telemetry.deployments)}</small></span></UiButton></UiTableCell>
              <UiTableCell><UiBadge className={`network-model-state ${entry.state}`}>{entry.state === "active" ? "Active" : modelRequestStatusLabel(entry.request?.status)}</UiBadge></UiTableCell>
              <UiTableCell><strong>{`${telemetry.peers.length} node${telemetry.peers.length === 1 ? "" : "s"}`}</strong><small>{entry.replicas} replicas · {entry.pipelines} pipelines</small></UiTableCell>
              <UiTableCell>{telemetry.peerMemoryMb > 0 ? formatMemory(telemetry.peerMemoryMb) : "Not reported"}</UiTableCell>
              <UiTableCell>{telemetry.measuredThroughput > 0 ? `${formatCompactNumber(telemetry.measuredThroughput)} tok/s` : "Not measured"}</UiTableCell>
              <UiTableCell>{telemetry.processedTokens > 0 ? formatCompactTokens(telemetry.processedTokens) : "No activity"}</UiTableCell>
              <UiTableCell><UiButton type="button" className="network-model-open" onClick={() => setSelectedModelId(entry.id)} aria-label={`View details for ${entry.id}`}><ChevronRight /></UiButton></UiTableCell>
            </UiTableRow>;
          })}</UiTableBody>
        </UiTable>
        {entries.length === 0 && <div className="network-model-empty"><Boxes /><strong>No models are active yet</strong><span>Models and their token activity will appear here as soon as a node publishes one.</span>{developerMode && <UiButton type="button" onClick={() => onNavigate("models")}>Open model catalog</UiButton>}</div>}
      </div>
      {entries.length > pageSize && <TablePagination label="models" page={visiblePage} pageCount={pageCount} total={entries.length} onPageChange={setPage} />}
    </UiCard>}
    {selectedEntry && createPortal(
      <NetworkModelDrawer entry={selectedEntry} snapshot={snapshot} theme={theme} titleId={drawerTitleId} onClose={closeSelectedModel} />,
      document.body,
    )}
  </>;
}

function NetworkModelDrawer({ entry, snapshot, theme, titleId, onClose }: {
  entry: NetworkCatalogEntry;
  snapshot: PublicSnapshot;
  theme: "light" | "dark";
  titleId: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const telemetry = networkModelTelemetry(snapshot, entry.id);
  const execution = modelExecutionSummary(snapshot, entry.id);
  const inputTokens = telemetry.jobs.reduce((total, job) => total + job.inputTokens, 0);
  const outputTokens = telemetry.jobs.reduce((total, job) => total + job.outputTokens, 0);
  const completedRequests = telemetry.jobs.filter((job) => job.status === "completed").length;
  const [peerPage, setPeerPage] = useState(0);
  const peerPageSize = TABLE_PAGE_SIZE;
  const peerPageCount = Math.max(1, Math.ceil(telemetry.peers.length / peerPageSize));
  const visiblePeerPage = Math.min(peerPage, peerPageCount - 1);
  const visiblePeers = telemetry.peers.slice(visiblePeerPage * peerPageSize, visiblePeerPage * peerPageSize + peerPageSize);
  useEffect(() => setPeerPage(0), [entry.id, telemetry.peers.length]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => firstFocusable(dialog)?.focus() ?? dialog.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      trapDialogTab(event, dialog);
    };
    window.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [onClose]);
  return <div className={`model-detail-backdrop ${theme === "light" ? "theme-light" : "theme-dark"}`} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <UiDialogPanel as="aside" ref={dialogRef} className="model-detail-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="model-detail-head">
        <div className="model-detail-icon"><Boxes /></div>
        <div><span>NETWORK MODEL</span><UiHeading as="h2" id={titleId}>{entry.id}</UiHeading><small>{networkModelRuntimeLabel(telemetry.deployments)}</small></div>
        <UiButton type="button" onClick={onClose} aria-label="Close model details"><X /></UiButton>
      </header>
      <div className="model-detail-badges"><span className={entry.state}><i />{entry.state === "active" ? "Active now" : modelRequestStatusLabel(entry.request?.status)}</span><span className={`execution ${execution.deviceType}`}><Cpu />{executionShortLabel(execution)}</span></div>
      <section className="model-detail-metrics" aria-label="Model telemetry">
        <ModelDetailMetric icon={Network} label="Availability" value={`${telemetry.peers.length} node${telemetry.peers.length === 1 ? "" : "s"}`} />
        <ModelDetailMetric icon={MemoryStick} label="Peer memory" value={telemetry.peerMemoryMb > 0 ? formatMemory(telemetry.peerMemoryMb) : "Not reported"} />
        <ModelDetailMetric icon={Coins} label="Processed tokens" value={telemetry.processedTokens > 0 ? formatCompactTokens(telemetry.processedTokens) : "No activity"} />
        <ModelDetailMetric icon={Gauge} label="Measured speed" value={telemetry.measuredThroughput > 0 ? `${formatCompactNumber(telemetry.measuredThroughput)} tok/s` : "Not measured"} />
      </section>
      <section className="model-detail-section">
        <div className="model-detail-section-title"><Activity /><UiHeading as="h3">Token activity</UiHeading></div>
        <div className="model-token-breakdown">
          <div><span>Input tokens</span><strong>{formatCompactTokens(inputTokens)}</strong></div>
          <div><span>Output tokens</span><strong>{formatCompactTokens(outputTokens)}</strong></div>
          <div><span>Completed requests</span><strong>{completedRequests}</strong></div>
        </div>
      </section>
      <section className="model-detail-section">
        <div className="model-detail-section-title"><Code2 /><UiHeading as="h3">Runtime identity</UiHeading></div>
        <div className="model-runtime-identity"><span><small>MODEL ID</small><code>{entry.id}</code></span><span><small>RUNTIME MODES</small><code>{networkModelRuntimeLabel(telemetry.deployments)}</code></span></div>
      </section>
      <section className="model-detail-section model-peer-section">
        <div className="model-detail-section-title"><Network /><UiHeading as="h3">Active peers</UiHeading><span>{telemetry.peers.length}</span></div>
        <div className="model-peer-table-wrap">
          <UiTable className="model-peer-table">
            <UiTableHead><UiTableRow><UiTableHeader>Node</UiTableHeader><UiTableHeader>Region</UiTableHeader><UiTableHeader>Device</UiTableHeader><UiTableHeader>Memory</UiTableHeader><UiTableHeader>Speed</UiTableHeader></UiTableRow></UiTableHead>
            <UiTableBody>{visiblePeers.map(({ worker, deployments }) => {
              const measured = deployments.filter(isMeasuredDeployment).reduce((total, deployment) => total + deployment.tokensPerSecond, 0);
              return <UiTableRow key={worker.id}><UiTableCell><strong><i />{shortId(worker.id)}</strong></UiTableCell><UiTableCell>{worker.region}</UiTableCell><UiTableCell>{worker.gpus[0]?.model ?? worker.kind}</UiTableCell><UiTableCell>{formatMemory(worker.offeredVramMb)}</UiTableCell><UiTableCell>{measured > 0 ? `${formatCompactNumber(measured)} tok/s` : "Not measured"}</UiTableCell></UiTableRow>;
            })}</UiTableBody>
          </UiTable>
          {telemetry.peers.length === 0 && <div className="model-peer-empty"><Server /><span>No active peer is advertising this model right now.</span></div>}
        </div>
        {telemetry.peers.length > peerPageSize && <TablePagination label="model peers" page={visiblePeerPage} pageCount={peerPageCount} total={telemetry.peers.length} onPageChange={setPeerPage} />}
      </section>
    </UiDialogPanel>
  </div>;
}

function ModelDetailMetric({ icon: Icon, label, value }: { icon: typeof Network; label: string; value: string }) {
  return <div><Icon /><span><small>{label}</small><strong>{value}</strong></span></div>;
}

function networkModelTelemetry(snapshot: PublicSnapshot, modelId: string) {
  const normalizedModelId = modelId.toLowerCase();
  const peers = snapshot.workers.flatMap((worker) => {
    const deployments = worker.deployments.filter((deployment) => deployment.model.toLowerCase() === normalizedModelId);
    return deployments.length > 0 && worker.connected ? [{ worker, deployments }] : [];
  });
  const deployments = peers.flatMap((peer) => peer.deployments);
  const jobs = snapshot.jobs.filter((job) => job.model.toLowerCase() === normalizedModelId);
  return {
    peers,
    deployments,
    jobs,
    peerMemoryMb: peers.reduce((total, peer) => total + peer.worker.offeredVramMb, 0),
    measuredThroughput: deployments.filter(isMeasuredDeployment).reduce((total, deployment) => total + deployment.tokensPerSecond, 0),
    processedTokens: jobs.reduce((total, job) => total + job.inputTokens + job.outputTokens, 0),
  };
}

function networkModelRuntimeLabel(deployments: PublicDeployment[]): string {
  const labels = [...new Set(deployments.map((deployment) => deployment.adapter ?? deployment.mode).filter(Boolean))];
  return labels.length > 0 ? labels.join(" · ") : "Runtime not reported";
}

function modelRequestStatusLabel(status: RequestedModelCapacity["status"] | undefined): string {
  if (!status) return "Queued";
  const labels: Record<RequestedModelCapacity["status"], string> = {
    profiling: "Profiling",
    waiting_capacity: "Waiting for capacity",
    ready: "Ready",
    activating: "Activating",
    active: "Active",
    incompatible: "Incompatible",
    failed: "Needs attention",
  };
  return labels[status];
}

const MESH_OVERVIEW_POSITIONS = [
  { x: 10, y: 24 }, { x: 19, y: 70 }, { x: 31, y: 42 }, { x: 38, y: 82 },
  { x: 62, y: 20 }, { x: 70, y: 58 }, { x: 82, y: 30 }, { x: 89, y: 73 },
  { x: 59, y: 84 }, { x: 28, y: 14 }, { x: 75, y: 86 }, { x: 92, y: 48 },
  { x: 8, y: 51 }, { x: 47, y: 16 },
] as const;

const MESH_AMBIENT_SPORES = [
  { x: 15, y: 35 }, { x: 24, y: 84 }, { x: 36, y: 18 }, { x: 43, y: 67 },
  { x: 57, y: 31 }, { x: 66, y: 76 }, { x: 78, y: 16 }, { x: 88, y: 58 },
  { x: 94, y: 28 }, { x: 7, y: 77 },
] as const;

function InteractiveMesh({ workers, traces, registeredWorkers, sharedVramMb, publicLink, external, developerMode, onNavigate }: {
  workers: PublicWorker[];
  traces: NetworkExecutionTrace[];
  registeredWorkers: number;
  sharedVramMb: number;
  publicLink: (path: string) => string;
  external: boolean;
  developerMode: boolean;
  onNavigate: (view: PanelView) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const visibleWorkers = workers.slice(0, MESH_OVERVIEW_POSITIONS.length);
  const selectedWorker = visibleWorkers.find((worker) => worker.id === selectedWorkerId) ?? null;
  const selectedWorkerIndex = selectedWorker ? visibleWorkers.findIndex((worker) => worker.id === selectedWorker.id) : -1;
  const selectedWorkerPosition = selectedWorkerIndex >= 0 ? MESH_OVERVIEW_POSITIONS[selectedWorkerIndex] ?? { x: 50, y: 50 } : null;
  const visibleOfferedVramMb = visibleWorkers.reduce((total, worker) => total + worker.offeredVramMb, 0);
  const selectedSharePercent = selectedWorker && visibleOfferedVramMb > 0 ? selectedWorker.offeredVramMb / visibleOfferedVramMb * 100 : 0;
  const positions = new Map<string, { x: number; y: number }>();
  visibleWorkers.forEach((worker, index) => {
    const position = MESH_OVERVIEW_POSITIONS[index] ?? { x: 50, y: 50 };
    positions.set(worker.id, position);
    if (worker.executionNodeId) positions.set(worker.executionNodeId, position);
  });
  const links = projectObservedTopology(visibleWorkers, traces).flatMap((link) => {
    const source = positions.get(link.sourceNodeId);
    const target = positions.get(link.destinationNodeId);
    return source && target ? [{ link, source, target }] : [];
  });
  const physicalLinks = links.filter(({ link }) => link.evidenceClass === "physical").length;

  useEffect(() => {
    const updateFullscreen = () => setFullscreen(document.fullscreenElement === cardRef.current);
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  function updatePointerGlow(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--mesh-pointer-x", `${((event.clientX - rect.left) / rect.width) * 100}%`);
    event.currentTarget.style.setProperty("--mesh-pointer-y", `${((event.clientY - rect.top) / rect.height) * 100}%`);
  }

  async function toggleFullscreen() {
    if (!cardRef.current) return;
    if (document.fullscreenElement === cardRef.current) await document.exitFullscreen();
    else await cardRef.current.requestFullscreen();
  }

  return (
    <UiCard className={`network-canvas interactive-mesh${fullscreen ? " fullscreen" : ""}`} ref={cardRef}>
      <div className="canvas-head mesh-canvas-head">
        <div><span>LIVE TOPOLOGY</span><strong>Explore the network</strong></div>
        <div className="mesh-head-status" aria-label={`${visibleWorkers.length} observed nodes and ${links.length} evidenced routes`}>
          <b><i /> OBSERVED</b>
          <span>{visibleWorkers.length} NODES</span>
          <span>{links.length} ROUTES</span>
        </div>
        <div className="mesh-head-actions">
          {developerMode && <UiButton className="canvas-link" onClick={() => onNavigate("nodes")}>Node details</UiButton>}
          <UiButton className="mesh-fullscreen-button" onClick={() => void toggleFullscreen()}><Maximize2 />{fullscreen ? "Exit fullscreen" : "Fullscreen"}</UiButton>
        </div>
      </div>
      <div
        className="interactive-mesh-stage"
        onPointerMove={updatePointerGlow}
        onPointerLeave={(event) => {
          event.currentTarget.style.setProperty("--mesh-pointer-x", "50%");
          event.currentTarget.style.setProperty("--mesh-pointer-y", "45%");
        }}
      >
        <div className="mesh-ambient mesh-ambient-one" />
        <div className="mesh-ambient mesh-ambient-two" />
        <div className="mesh-scene" style={{ "--mesh-zoom": zoom } as CSSProperties}>
          <div className="mesh-grid" />
          <div className="mesh-spores" aria-hidden="true">
            {MESH_AMBIENT_SPORES.map((spore, index) => <i key={`${spore.x}-${spore.y}`} style={{ "--spore-x": `${spore.x}%`, "--spore-y": `${spore.y}%`, "--spore-delay": `${index * -0.83}s` } as CSSProperties} />)}
          </div>
          <svg className="mesh-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <filter id="mesh-packet-glow" x="-200%" y="-200%" width="500%" height="500%">
                <feGaussianBlur stdDeviation=".8" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            {links.map(({ link, source, target }) => {
              const path = `M ${source.x} ${source.y} L ${target.x} ${target.y}`;
              return <g key={`${link.sourceNodeId}:${link.destinationNodeId}:${link.transport}`} className={`mesh-link-${link.evidenceClass}`}>
                <path d={path} pathLength="1" />
              </g>;
            })}
          </svg>
          <div className="mesh-core" role="img" aria-label="mycellios coordinator">
            <span><Network size={25} strokeWidth={1.6} aria-hidden="true" /></span>
            <strong>Mycellios</strong>
            <small>coordinator</small>
            <i />
          </div>
          {visibleWorkers.map((worker, index) => {
            const position = MESH_OVERVIEW_POSITIONS[index] ?? { x: 50, y: 50 };
            const selected = selectedWorkerId === worker.id;
            return (
              <UiButton
                className={`mesh-node ${worker.kind}${selected ? " selected" : ""}`}
                style={{ "--node-x": `${position.x}%`, "--node-y": `${position.y}%`, "--node-delay": `${index * -0.41}s` } as CSSProperties}
                key={worker.id}
                onClick={() => setSelectedWorkerId(selected ? "" : worker.id)}
                aria-pressed={selected}
                aria-label={`${workerLabel(worker)}, ${worker.gpus[0]?.model ?? worker.kind}`}
              >
                <span><WorkerKindIcon worker={worker} /><i /></span>
                <strong>{workerLabel(worker)}</strong>
                <small>{worker.gpus[0]?.model ?? worker.kind}</small>
              </UiButton>
            );
          })}
        </div>
        {visibleWorkers.length === 0 && <div className="network-empty interactive-empty"><Wifi size={28} /><strong>No nodes are connected right now</strong><span>Connected devices appear in the live topology.</span><UiLink href={publicLink("/browser/")} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>Connect this device <ArrowRight size={13} /></UiLink></div>}
        <div className="mesh-stage-legend"><b><i /> OBSERVED</b><span>{physicalLinks} physical</span><span>{links.length - physicalLinks} declared/simulated</span>{links.length === 0 && <span>No route observed yet</span>}</div>
        {selectedWorker && selectedWorkerPosition && <MeshNodePopover worker={selectedWorker} position={selectedWorkerPosition} sharePercent={selectedSharePercent} onClose={() => setSelectedWorkerId("")} />}
        {visibleWorkers.length > 0 && <div className="mesh-zoom-controls" aria-label="Network zoom controls">
          <UiButton onClick={() => setZoom((value) => Math.min(1.35, value + 0.12))} disabled={zoom >= 1.35} aria-label="Zoom in"><Plus /></UiButton>
          <output>{Math.round(zoom * 100)}%</output>
          <UiButton onClick={() => setZoom((value) => Math.max(0.76, value - 0.12))} disabled={zoom <= 0.76} aria-label="Zoom out"><Minus /></UiButton>
        </div>}
      </div>
      <div className="network-summary mesh-network-summary">
        <div><span>Nodes online</span><strong>{workers.length} / {registeredWorkers}</strong></div>
        <div><span>Evidenced routes</span><strong>{links.length}</strong></div>
        <div><span>Shared VRAM</span><strong>{formatMemory(sharedVramMb)}</strong></div>
      </div>
    </UiCard>
  );
}

export function MeshNodePopover({ worker, position, sharePercent, onClose }: {
  worker: PublicWorker;
  position: { x: number; y: number };
  sharePercent: number;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const models = [...new Set(worker.deployments.map((deployment) => deployment.model))];
  const status = workerPeerStatus(worker);
  const role = workerPeerRole(worker);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.requestAnimationFrame(() => firstFocusable(dialog)?.focus() ?? dialog.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, []);
  return <UiDialogPanel as="aside"
    ref={dialogRef}
    className={`mesh-node-popover ${position.y < 44 ? "below" : "above"}`}
    role="dialog"
    aria-label={`Node details for ${workerLabel(worker)}`}
    tabIndex={-1}
    style={{
      "--mesh-popover-x": `${Math.max(18, Math.min(82, position.x))}%`,
      "--mesh-popover-y": `${position.y}%`,
    } as CSSProperties}
  >
    <UiButton className="mesh-node-popover-close" onClick={onClose} aria-label="Close node details"><X /></UiButton>
    <header>
      <div><strong>{workerLabel(worker)}</strong><small>{shortId(worker.id)}</small></div>
      <UiBadge className={`peer-state ${status}`}><i />{peerStatusLabel(status)}</UiBadge>
    </header>
    <div className="mesh-node-popover-meta">
      <span className={`peer-role ${role.toLowerCase()}`}>{role}</span>
      <span><Timer size={12} />Seen {relativeTime(worker.lastSeenAt)}</span>
    </div>
    <div className="mesh-node-popover-grid">
      <small><span><Boxes size={11} />Model</span><b title={models[0] ?? "No model hosted"}>{models[0] ?? "No model hosted"}</b></small>
      <small><span><Code2 size={11} />Version</span><b>{worker.agentVersion ? `v${worker.agentVersion}` : "Legacy"}</b></small>
      <small><span><MemoryStick size={11} />Shared VRAM</span><b>{formatMemory(worker.offeredVramMb)}</b></small>
      <small><span><Activity size={11} />Reliability</span><b>{Math.round(Math.max(0, Math.min(1, worker.reliability)) * 100)}%</b></small>
    </div>
    <footer>
      <span><Network size={12} />{Math.round(sharePercent)}% mesh share</span>
      <i />
      <span>{models.length} model{models.length === 1 ? "" : "s"}</span>
      <i />
      <span>{worker.region}</span>
    </footer>
  </UiDialogPanel>;
}

export function Nodes({
  snapshot,
  onRemove,
  onClearOffline,
  onListCredentials,
  onRevokeCredential,
}: {
  snapshot: PublicSnapshot;
  onRemove: (workerId: string) => Promise<void>;
  onClearOffline: () => Promise<void>;
  onListCredentials: () => Promise<WorkerCredentialSummary[]>;
  onRevokeCredential: (
    credential: Pick<WorkerCredentialSummary, "identityKind" | "identityId" | "fingerprint">,
    reason: string,
  ) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [credentials, setCredentials] = useState<WorkerCredentialSummary[] | null>(null);
  const [credentialsPage, setCredentialsPage] = useState(0);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const connectedWorkers = snapshot.workers.filter((worker) => worker.connected);
  const activeWorkers = snapshot.workers.filter((worker) => worker.connected && worker.status === "online");
  const physicalWorkers = snapshot.workers.filter((worker) => worker.kind !== "cell");
  const activePhysicalWorkers = activeWorkers.filter((worker) => worker.kind !== "cell");
  const connectedPhysicalWorkers = connectedWorkers.filter((worker) => worker.kind !== "cell");
  const installedWorkers = snapshot.workers.filter((worker) => worker.kind === "desktop");
  const browserWorkers = snapshot.workers.filter((worker) => worker.kind === "browser");
  const cellWorkers = snapshot.workers.filter((worker) => worker.kind === "cell");
  const activeGpus = activeWorkers.flatMap((worker) => worker.gpus);
  const activeDeployments = activeWorkers.flatMap((worker) => worker.deployments);
  const telemetryGpus = activeGpus.filter((gpu) => gpu.utilizationPct !== undefined);
  const poweredGpus = activeGpus.filter((gpu) => (gpu.powerW ?? 0) > 0);
  const activeOfferedVramMb = activeGpus.reduce((total, gpu) => total + gpu.offeredVramMb, 0);
  const freeVramMb = activeGpus.reduce((total, gpu) => total + gpu.freeOfferedVramMb, 0);
  const averageUtilization = telemetryGpus.length > 0 ? telemetryGpus.reduce((total, gpu) => total + (gpu.utilizationPct ?? 0), 0) / telemetryGpus.length : null;
  const observedPowerW = poweredGpus.reduce((total, gpu) => total + (gpu.powerW ?? 0), 0);
  const measuredDeployments = activeDeployments.filter(isMeasuredDeployment);
  const measuredThroughput = measuredDeployments.reduce((total, deployment) => total + deployment.tokensPerSecond, 0);
  const sortedWorkers = [...snapshot.workers].sort((left, right) => nodeStateOrder(left) - nodeStateOrder(right));
  const selectedWorker = snapshot.workers.find((worker) => worker.id === selectedWorkerId) ?? null;
  const credentialsPageSize = TABLE_PAGE_SIZE;
  const credentialsPageCount = Math.max(1, Math.ceil((credentials?.length ?? 0) / credentialsPageSize));
  const visibleCredentialsPage = Math.min(credentialsPage, credentialsPageCount - 1);
  const visibleCredentials = credentials?.slice(visibleCredentialsPage * credentialsPageSize, visibleCredentialsPage * credentialsPageSize + credentialsPageSize) ?? [];
  async function remove(workerId: string) {
    setBusy(workerId);
    setActionError(null);
    try {
      await onRemove(workerId);
    } catch (error) {
      setActionError(friendlyModelMutationError(error));
    } finally {
      setBusy(null);
    }
  }
  async function clearOffline() {
    setBusy("offline");
    setActionError(null);
    try {
      await onClearOffline();
    } catch (error) {
      setActionError(friendlyModelMutationError(error));
    } finally {
      setBusy(null);
    }
  }
  async function loadCredentials() {
    setBusy("credentials");
    setCredentialError(null);
    try {
      setCredentials(await onListCredentials());
      setCredentialsPage(0);
    } catch (error) {
      setCredentialError(friendlyModelMutationError(error));
    } finally {
      setBusy(null);
    }
  }
  async function revokeCredential(credential: WorkerCredentialSummary) {
    if (
      !window.confirm(
        `Revoke access for ${credential.identityId}? This device will disconnect and cannot sign in again with this key.`,
      )
    ) return;
    setBusy(`credential:${credential.fingerprint}`);
    setCredentialError(null);
    try {
      await onRevokeCredential(
        credential,
        "Manually revoked from the network panel",
      );
      setCredentials(await onListCredentials());
    } catch (error) {
      setCredentialError(friendlyModelMutationError(error));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="nodes-page minimal-screen">
      <PageTitle eyebrow="DISTRIBUTED NETWORK" title="Node network" copy="Physical devices, active browsers and compute cells connected to mycellios." actions={<UiButton disabled={busy !== null} onClick={() => void clearOffline()}><Trash2 size={15} /> Clear offline</UiButton>} />
      {actionError && <div className="inline-error" role="alert"><CircleAlert size={17} />{actionError}</div>}

      <SummaryStrip label="Device summary" items={[{ label: "Connected devices", value: connectedPhysicalWorkers.length }, { label: "Shared memory", value: formatMemory(activeOfferedVramMb) }, { label: "Measured speed", value: measuredThroughput > 0 ? `${formatCompactNumber(measuredThroughput)} tok/s` : "Not measured" }]} />
      <PanelDisclosure icon={Gauge} eyebrow="ON DEMAND" title="Physical telemetry" summary="GPU load, reporting coverage, and observed power.">
        <div className="node-overview-grid compact">
          <NodeOverviewStat icon={Gauge} label="Average GPU load" value={averageUtilization === null ? "No data" : `${averageUtilization.toFixed(0)}%`} detail={`${telemetryGpus.length} GPU${telemetryGpus.length === 1 ? "" : "s"} reporting telemetry`} progress={averageUtilization === null ? 0 : averageUtilization / 100} tone="purple" />
          <NodeOverviewStat icon={Activity} label="GPUs with telemetry" value={`${telemetryGpus.length} / ${activeGpus.length}`} detail={telemetryGpus.length > 0 ? `${telemetryGpus.length} GPU${telemetryGpus.length === 1 ? "" : "s"} sending physical load` : "No GPU is reporting this reading"} progress={activeGpus.length > 0 ? telemetryGpus.length / activeGpus.length : 0} tone="cyan" />
          <NodeOverviewStat icon={CirclePower} label="Observed GPU power" value={poweredGpus.length > 0 ? formatPower(observedPowerW) : "No data"} detail={poweredGpus.length > 0 ? "Sum of watts reported by GPUs" : telemetryGpus.length > 0 ? "Real load exists, but the driver exposes no wattage" : "Never estimated or invented"} tone="orange" />
        </div>
      </PanelDisclosure>

      <PanelDisclosure icon={Network} eyebrow="ON DEMAND" title="Live topology" summary={`${activeWorkers.length} active connections. Open the network map when you need routing context.`}>
      <section className="node-topology-card">
        <header className="node-topology-head">
          <div><span>LIVE TOPOLOGY</span><UiHeading as="h2">Coordinator connections</UiHeading><UiText>Each line represents a real session with mycellios.</UiText></div>
          <div className="node-topology-legend"><span><i className="active" />Active</span><span><i className="warning" />Needs attention</span><span><i className="offline" />Offline</span></div>
        </header>
        <div className={`node-topology-map${snapshot.workers.length === 0 ? " empty" : ""}`}>
          <div className="node-topology-grid" />
          <svg className="node-topology-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {sortedWorkers.map((worker, index) => {
              const position = topologyPosition(index, sortedWorkers.length);
              return <line key={worker.id} className={`${nodeVisualState(worker)}${selectedWorker?.id === worker.id ? " selected" : ""}`} x1="50" y1="52" x2={position.x} y2={position.y} vectorEffect="non-scaling-stroke" />;
            })}
          </svg>
          <div className="node-network-hub"><div><Network /></div><strong>mycellios</strong><span>{activeWorkers.length} active</span><i /></div>
          {sortedWorkers.map((worker, index) => {
            const position = topologyPosition(index, sortedWorkers.length);
            const label = workerLabel(worker);
            return <UiButton
              type="button"
              key={worker.id}
              aria-label={`View node ${label}`}
              aria-pressed={selectedWorker?.id === worker.id}
              className={`topology-node ${nodeVisualState(worker)}${selectedWorker?.id === worker.id ? " selected" : ""}`}
              style={{ "--node-x": `${position.x}%`, "--node-y": `${position.y}%` } as CSSProperties}
              onClick={() => setSelectedWorkerId(worker.id)}
            ><div><WorkerKindIcon worker={worker} /><i /></div><span><strong>{label}</strong><small>{worker.region} · {nodeStatusLabel(worker)}</small></span></UiButton>;
          })}
          {snapshot.workers.length === 0 && <div className="node-topology-empty"><Server /><strong>No nodes yet</strong><span>Connect a machine to see it appear on the network.</span></div>}
        </div>
      </section>
      </PanelDisclosure>

      <PanelDisclosure icon={ShieldCheck} eyebrow="ADMINISTRATION" title="Device trust" summary="Signed identities and access revocation.">
      <section className="device-trust-card">
        <header>
          <div>
            <span>DEVICE TRUST</span>
            <UiHeading as="h2">Signed identities</UiHeading>
            <UiText>Administrative inventory of enrolled keys. Revoking cuts the active session and blocks new registrations.</UiText>
          </div>
          <UiButton
            type="button"
            disabled={busy !== null}
            onClick={() => void loadCredentials()}
          >
            {busy === "credentials" ? <LoaderCircle className="spin" /> : <ShieldCheck />}
            {credentials === null ? "Load identities" : "Refresh"}
          </UiButton>
        </header>
        {credentialError && <div className="inline-error" role="alert"><CircleAlert size={17} />{credentialError}</div>}
        {credentials !== null && credentials.length === 0 && (
          <div className="device-trust-empty">
            <ShieldCheck />
            <strong>No enrolled credentials yet</strong>
            <span>Devices appear here after completing their first signed challenge.</span>
          </div>
        )}
        {credentials !== null && credentials.length > 0 && (
          <div className="device-trust-list">
            {visibleCredentials.map((credential) => (
              <UiCard key={`${credential.identityKind}:${credential.identityId}`}>
                <div className="device-trust-identity">
                  <div><LockKeyhole /></div>
                  <span>
                    <small>{credentialKindLabel(credential.identityKind)}</small>
                    <strong>{credential.identityId}</strong>
                    <em title={credential.fingerprint}>{shortFingerprint(credential.fingerprint)}</em>
                  </span>
                </div>
                <div className="device-trust-meta">
                  <span><small>Protocol</small><strong>v{credential.protocolVersion}</strong></span>
                  <span><small>Last seen</small><strong>{relativeTime(credential.lastSeenAt)}</strong></span>
                  <span><small>Status</small><strong className={credential.status}>{credential.status === "active" ? "Active" : "Revoked"}</strong></span>
                </div>
                <div className="device-trust-action">
                  {credential.status === "active" ? (
                    <UiButton
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void revokeCredential(credential)}
                    >
                      {busy === `credential:${credential.fingerprint}`
                        ? <LoaderCircle className="spin" />
                        : <CircleAlert />}
                      Revoke access
                    </UiButton>
                  ) : (
                    <span title={credential.revocationReason ?? undefined}>
                      {credential.revokedAt ? `Revoked ${relativeTime(credential.revokedAt)}` : "Revoked"}
                    </span>
                  )}
                </div>
              </UiCard>
            ))}
          </div>
        )}
        {(credentials?.length ?? 0) > credentialsPageSize && <TablePagination label="device identities" page={visibleCredentialsPage} pageCount={credentialsPageCount} total={credentials?.length ?? 0} onPageChange={setCredentialsPage} />}
      </section>
      </PanelDisclosure>

      <NodeInventorySection eyebrow="INSTALLED DEVICES" title="Physical devices" workers={installedWorkers} snapshot={snapshot} busy={busy} onRemove={remove} onSelect={setSelectedWorkerId} />
      {browserWorkers.length > 0 && <PanelDisclosure icon={Globe2} title="Browser devices"><NodeInventorySection eyebrow="TEMPORARY CAPACITY" title="Active browsers" workers={browserWorkers} snapshot={snapshot} busy={busy} onRemove={remove} onSelect={setSelectedWorkerId} /></PanelDisclosure>}
      {cellWorkers.length > 0 && <PanelDisclosure icon={Cpu} title="Compute cells"><NodeInventorySection eyebrow="DISTRIBUTED EXECUTORS" title="Compute cells" workers={cellWorkers} snapshot={snapshot} busy={busy} onRemove={remove} onSelect={setSelectedWorkerId} /></PanelDisclosure>}
      {snapshot.workers.length === 0 && <div className="node-card-grid"><div className="wide-empty"><Empty icon={Server} title="No registered nodes" copy="Open the browser worker to add the first machine. Native packages appear on Downloads when published." /><UiLink href="/browser/">Connect a device <ArrowRight size={15} /></UiLink></div></div>}
      {selectedWorker && <NodeDetailsDrawer worker={selectedWorker} snapshot={snapshot} onClose={() => setSelectedWorkerId("")} />}
    </section>
  );
}

function NodeInventorySection({ eyebrow, title, workers, snapshot, busy, onRemove, onSelect }: {
  eyebrow: string;
  title: string;
  workers: PublicWorker[];
  snapshot: PublicSnapshot;
  busy: string | null;
  onRemove: (workerId: string) => Promise<void>;
  onSelect: (workerId: string) => void;
}) {
  if (workers.length === 0) return null;
  return <>
    <div className="node-list-heading"><div><span>{eyebrow}</span><UiHeading as="h2">{title}</UiHeading></div><strong>{workers.length} registered</strong></div>
    <div className="node-card-grid compact">
      {workers.map((worker) => {
        const execution = workerExecutionSummary(snapshot, worker);
        const remoteRepair = worker.acceleration;
        const autoRepair = executionAutoRepairActive(execution, snapshot.workers)
          || Boolean(remoteRepair?.retryable && remoteRepair.state !== "gpu-ready");
        return <UiCard className="node-card" key={worker.id}>
        <div className="node-card-head"><div className={`node-device ${worker.kind}`}><WorkerKindIcon worker={worker} /></div><div><span>{workerKindLabel(worker)}</span><UiHeading as="h2">{workerLabel(worker)}</UiHeading><small>{shortId(worker.id)}</small></div><UiBadge className={`node-status ${worker.status}`}><i />{nodeStatusLabel(worker)}</UiBadge></div>
        <div className={`node-runtime-state${autoRepair ? " repairing" : ""}`}><ExecutionBadge execution={execution} workers={snapshot.workers} /><span><strong>{remoteRepair?.retryable && remoteRepair.state !== "gpu-ready" ? `GPU auto-repair · ${remoteRepair.phase} · ${remoteRepair.progressPct ?? 0}%` : autoRepair ? "Service maintained on CPU · auto-repair active" : execution.verified ? executionDetail(execution) : "No active model is reporting execution on this node"}</strong><small>{remoteRepair?.retryable && remoteRepair.state !== "gpu-ready" ? remoteRepair.issueSummary ?? "mycellios is rebuilding and revalidating the local GPU runtime." : autoRepair ? "mycellios will revalidate the GPU and migrate this stage automatically." : execution.verified ? executionDeviceNames(execution) : "Detected GPU hardware is not counted as active compute."}</small></span></div>
        <div className="node-card-quick"><span><MemoryStick size={14} />{formatMemory(worker.offeredVramMb)} offered</span><span><Globe2 size={14} />{worker.region}</span></div>
        <div className="node-card-foot"><span>Seen {relativeTime(worker.lastSeenAt)}</span><div><UiButton type="button" onClick={() => onSelect(worker.id)}>View details</UiButton><UiButton disabled={busy !== null} onClick={() => void onRemove(worker.id)}>{busy === worker.id ? <LoaderCircle className="spin" /> : <Trash2 />} Remove</UiButton></div></div>
      </UiCard>;})}
    </div>
  </>;
}

function NodeDetailsDrawer({ worker, snapshot, onClose }: { worker: PublicWorker; snapshot: PublicSnapshot; onClose: () => void }) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable.item(0);
      const last = focusable.item(focusable.length - 1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);
  return createPortal(<div className="panel-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <UiDialogPanel as="aside" ref={drawerRef} className="panel-detail-drawer" role="dialog" aria-modal="true" aria-label={`Node details for ${workerLabel(worker)}`}>
      <header><span><small>NODE DETAILS</small><strong>{workerLabel(worker)}</strong></span><UiButton ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close node details"><X /></UiButton></header>
      <NodeTopologyInspector worker={worker} snapshot={snapshot} />
    </UiDialogPanel>
  </div>, document.querySelector(".public-panel") ?? document.body);
}

function NodeOverviewStat({ icon: Icon, label, value, detail, progress, tone }: { icon: typeof Server; label: string; value: string; detail: string; progress?: number; tone: "green" | "blue" | "purple" | "violet" | "cyan" | "orange" }) {
  return <UiCard className={`node-overview-stat ${tone}`}><div className="node-overview-icon"><Icon /></div><span>{label}</span><strong>{value}</strong><small>{detail}</small>{progress !== undefined && <div className="node-overview-progress"><i style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }} /></div>}</UiCard>;
}

function NodeTopologyInspector({ worker, snapshot }: { worker: PublicWorker; snapshot: PublicSnapshot }) {
  const gpus = worker.gpus;
  const free = gpus.reduce((total, gpu) => total + gpu.freeOfferedVramMb, 0);
  const physicalVram = gpus.reduce((total, gpu) => total + gpu.physicalVramMb, 0);
  const utilizations = gpus.filter((gpu) => gpu.utilizationPct !== undefined);
  const utilization = utilizations.length > 0 ? utilizations.reduce((total, gpu) => total + (gpu.utilizationPct ?? 0), 0) / utilizations.length : null;
  const temperatures = gpus.map((gpu) => gpu.temperatureC).filter((value): value is number => Number.isFinite(value));
  const maximumTemperature = temperatures.length > 0 ? Math.max(...temperatures) : null;
  const powerReadings = gpus.map((gpu) => gpu.powerW).filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
  );
  const observedPower = powerReadings.length > 0 ? powerReadings.reduce((total, value) => total + value, 0) : null;
  const measuredDeployments = worker.deployments.filter(isMeasuredDeployment);
  const throughput = measuredDeployments.reduce((total, deployment) => total + deployment.tokensPerSecond, 0);
  const execution = workerExecutionSummary(snapshot, worker);
  const kind = worker.kind === "cell" ? "Logical cell" : worker.kind === "browser" ? "Browser" : "Installed device";
  const computeMode = worker.computeMode ? computeModeLabel(worker.computeMode) : worker.kind === "cell" ? "Orchestrated" : "Not reported";
  return <div className="node-topology-inspector">
    <div className={`node-inspector-identity ${nodeVisualState(worker)}`}><div><WorkerKindIcon worker={worker} /></div><span><small>{worker.kind === "cell" ? "SELECTED CELL" : "SELECTED NODE"}</small><strong>{workerLabel(worker)}</strong><em>{worker.region} · {shortId(worker.id)}</em><ExecutionBadge execution={execution} workers={snapshot.workers} /></span></div>
    <div className="node-inspector-metrics">
      <Metric label="Status" value={nodeStatusLabel(worker)} />
      <Metric label="Type" value={kind} />
      <Metric label="Region" value={worker.region} />
      <Metric label="Last seen" value={relativeTime(worker.lastSeenAt)} />
      <Metric label="Reliability" value={`${Math.round(Math.max(0, Math.min(1, worker.reliability)) * 100)}%`} />
      <Metric label="Version" value={worker.agentVersion ? `v${worker.agentVersion}` : "Legacy"} />
      <Metric label="Reported build" value={shortBuildIdentity(worker.buildIdentity)} />
      <Metric label={worker.kind === "cell" ? "Combined capacity" : "Physical VRAM"} value={physicalVram > 0 ? formatMemory(physicalVram) : "No data"} />
      <Metric label="Offered memory" value={formatMemory(worker.offeredVramMb)} />
      <Metric label="Free memory" value={formatMemory(free)} />
      <Metric label="GPU load" value={utilization === null ? "No data" : `${utilization.toFixed(0)}%`} />
      <Metric label="Peak temperature" value={maximumTemperature === null ? "No data" : `${maximumTemperature.toFixed(0)} °C`} />
      <Metric label="GPU power" value={observedPower === null ? "No data" : formatPower(observedPower)} />
      <Metric label="Verified compute" value={execution.verified ? executionShortLabel(execution) : "Unverified"} />
      <Metric label="Physical probe" value={capabilityStateLabel(worker.observedCapability?.probe.state)} />
      <Metric label="Canary" value={capabilityStateLabel(worker.observedCapability?.canary.state)} />
      <Metric label="Eligibility" value={worker.observedCapability?.eligibility.serving ? "Verified serving" : worker.observedCapability?.eligibility.activation ? "Ready to activate" : "Claim only"} />
      <Metric label="GPU runtime" value={worker.acceleration ? remoteAccelerationLabel(worker.acceleration) : "No diagnostics"} />
      <Metric label="Mode" value={computeMode} />
      <Metric label="Measured inference" value={throughput > 0 ? `${formatCompactNumber(throughput)} tok/s` : "Not measured"} />
      <Metric label="Models" value={String(worker.deployments.length)} />
      <Metric label="Completed" value={String(worker.jobsCompleted)} />
    </div>
    {worker.acceleration && <RemoteAccelerationDiagnostics diagnostics={worker.acceleration} />}
    {worker.isolation && <ExecutorIsolationDiagnostics isolation={worker.isolation} />}
  </div>;
}

function capabilityStateLabel(
  state: "missing" | "verified" | "stale" | "invalid" | undefined,
): string {
  if (state === "verified") return "Verified";
  if (state === "stale") return "Stale";
  if (state === "invalid") return "Invalid";
  return "Pending";
}

function ExecutorIsolationDiagnostics({
  isolation,
}: {
  isolation: NonNullable<PublicWorker["isolation"]>;
}) {
  const jobObject = isolation.killOnClose === "windows-job-object";
  return <UiDisclosure className="executor-isolation-diagnostics">
    <UiDisclosureSummary>
      <span><ShieldCheck />Executor isolation</span>
      <strong>{jobObject ? "PARTIAL · JOB OBJECT" : "PARTIAL · SEALED POLICY"}</strong>
      <ChevronDown />
    </UiDisclosureSummary>
    <div className="executor-isolation-body">
      <UiText className="executor-isolation-summary">
        <ShieldCheck />
        <span><strong>Active, verifiable controls.</strong> The process receives a filtered environment, a private temporary directory and a watchdog that stops the route when it exceeds its limits.{jobObject ? " Windows also places it in a Job Object before execution and closes the entire tree if the application exits." : ""}</span>
      </UiText>
      <div className="executor-isolation-grid">
        <Metric label="Environment" value="Filtered variables" />
        <Metric label="Private temp space" value={`Max ${formatMemory(isolation.maxWorkspaceBytes / (1024 * 1024))}`} />
        <Metric label="Temporary files" value={`Max ${isolation.maxWorkspaceEntries.toLocaleString("en-US")}`} />
        <Metric label="Watchdog" value={`Every ${isolation.workspaceCheckIntervalMs} ms`} />
        <Metric label="Process tree" value={jobObject ? "Windows Job Object" : "Best-effort close"} />
        <Metric label="On close" value={jobObject ? "Guaranteed termination" : "No OS guarantee"} />
        <Metric label="Policy" value={isolation.launchPolicySchema.replace("gdlp-executor-isolation/", "v")} />
      </div>
      <div className="executor-isolation-pending">
        <CircleAlert />
        <span><strong>Strong isolation still pending.</strong> This node does not yet announce an operating-system sandbox or hard CPU/RAM/GPU quotas{jobObject ? "." : " or a kill-on-close guarantee."}</span>
      </div>
    </div>
  </UiDisclosure>;
}

function RemoteAccelerationDiagnostics({
  diagnostics,
}: {
  diagnostics: NonNullable<PublicWorker["acceleration"]>;
}) {
  const repairing = diagnostics.retryable && diagnostics.state !== "gpu-ready";
  return <UiDisclosure className={`remote-accelerator-diagnostics${repairing ? " repairing" : diagnostics.state === "gpu-ready" ? " ready" : ""}`}>
    <UiDisclosureSummary>
      <span><Activity />{repairing ? "GPU self-repair" : "GPU diagnostics"}</span>
      <strong>{remoteAccelerationLabel(diagnostics)}</strong>
      <ChevronDown />
    </UiDisclosureSummary>
    <div className="remote-accelerator-body">
      <div className="remote-accelerator-grid">
        <Metric label="App" value={`v${diagnostics.appVersion}`} />
        <Metric label="Backend" value={(diagnostics.backend ?? "pending").toUpperCase()} />
        <Metric label="Phase" value={diagnostics.phase} />
        <Metric label="Attempt" value={String(diagnostics.retryAttempt)} />
      </div>
      {diagnostics.progressPct !== null && <div className="remote-accelerator-progress"><i style={{ width: `${diagnostics.progressPct}%` }} /></div>}
      {diagnostics.issueSummary && <UiText><CircleAlert />{diagnostics.issueSummary}</UiText>}
      {diagnostics.nextRetryAt && <small>Next automatic retry: {new Date(diagnostics.nextRetryAt).toLocaleString()}</small>}
      {diagnostics.recentEvents.length > 0 && <ol>{diagnostics.recentEvents.map((event, index) => <li className={event.level} key={`${event.at}-${index}`}><time>{new Date(event.at).toLocaleTimeString()}</time><span>{event.message}</span></li>)}</ol>}
    </div>
  </UiDisclosure>;
}

function remoteAccelerationLabel(diagnostics: NonNullable<PublicWorker["acceleration"]>): string {
  if (diagnostics.state === "gpu-ready") return `${diagnostics.gpuModel ?? diagnostics.deviceName ?? "GPU"} ready`;
  if (diagnostics.retryable) return `${diagnostics.phase} · retry ${diagnostics.retryAttempt}`;
  return diagnostics.issueCode ?? diagnostics.state;
}

export function Models({ snapshot, onSearch, onRequest, onRemove, adminToken: initialAdminToken, requiresAdminToken, secureTokenStorage }: {
  snapshot: PublicSnapshot;
  onSearch: (input: HubCatalogSearchInput) => Promise<HubCatalogPage>;
  onRequest: (input: RequestModelInput, adminToken: string) => Promise<void>;
  onRemove: (modelId: string, adminToken: string) => Promise<void>;
  adminToken: string;
  requiresAdminToken: boolean;
  secureTokenStorage: boolean;
}) {
  const [activePage, setActivePage] = useState(0);
  const [source, setSource] = useState("");
  const [modelId, setModelId] = useState("");
  const [revision, setRevision] = useState("");
  const [contextTokens, setContextTokens] = useState(4096);
  const [minimumNodes, setMinimumNodes] = useState(2);
  const [autoActivate, setAutoActivate] = useState(true);
  const [adminToken, setAdminToken] = useState(initialAdminToken);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogModels, setCatalogModels] = useState<HubCatalogModel[]>([]);
  const [catalogBusy, setCatalogBusy] = useState(true);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(true);
  const [catalogNextCursor, setCatalogNextCursor] = useState<string | null>(null);
  const [catalogSort, setCatalogSort] = useState<HubCatalogSort | "name" | "memory">("downloads");
  const [catalogStatus, setCatalogStatus] = useState<"all" | "compatible" | "unsupported" | "gated">("compatible");
  const [catalogFit, setCatalogFit] = useState<"all" | "fits" | "too-large">("all");
  const searchSequence = useRef(0);
  const selectedCatalogModel = catalogModels.find((model) => model.id === source) ?? null;
  const catalogRemoteSort: HubCatalogSort = catalogSort === "likes" || catalogSort === "lastModified" ? catalogSort : "downloads";
  const availableCatalogMemoryMiB = snapshot.workers
    .filter((worker) => worker.connected && worker.status === "online")
    .flatMap((worker) => worker.gpus)
    .reduce((total, gpu) => total + gpu.freeOfferedVramMb, 0);
  const visibleCatalogModels = useMemo(() => {
    const filtered = catalogModels.filter((model) => {
      if (catalogStatus === "compatible" && !model.compatible) return false;
      if (catalogStatus === "unsupported" && (model.compatible || model.gated)) return false;
      if (catalogStatus === "gated" && !model.gated) return false;
      const memory = estimatedHubMemoryMiB(model);
      if (catalogFit === "fits" && (memory === null || memory > availableCatalogMemoryMiB)) return false;
      if (catalogFit === "too-large" && (memory === null || memory <= availableCatalogMemoryMiB)) return false;
      return true;
    });
    if (catalogSort === "name") return filtered.slice().sort((left, right) => left.id.localeCompare(right.id));
    if (catalogSort === "memory") return filtered.slice().sort((left, right) => (estimatedHubMemoryMiB(left) ?? Number.MAX_SAFE_INTEGER) - (estimatedHubMemoryMiB(right) ?? Number.MAX_SAFE_INTEGER));
    return filtered;
  }, [availableCatalogMemoryMiB, catalogFit, catalogModels, catalogSort, catalogStatus]);
  const activePageSize = TABLE_PAGE_SIZE;
  const activePageCount = Math.max(1, Math.ceil(snapshot.models.length / activePageSize));
  const visibleActivePage = Math.min(activePage, activePageCount - 1);
  const visibleActiveModels = snapshot.models.slice(visibleActivePage * activePageSize, visibleActivePage * activePageSize + activePageSize);
  useEffect(() => setActivePage(0), [snapshot.models]);

  useEffect(() => {
    const query = catalogQuery.trim();
    if (query.length === 1) {
      setCatalogModels([]);
      setCatalogNextCursor(null);
      setCatalogBusy(false);
      setCatalogLoadingMore(false);
      setCatalogError(null);
      return;
    }
    const sequence = ++searchSequence.current;
    setCatalogBusy(true);
    setCatalogLoadingMore(false);
    setCatalogError(null);
    const timer = window.setTimeout(() => {
      void onSearch({ query, sort: catalogRemoteSort, limit: 20 }).then(
        (page) => {
          if (searchSequence.current !== sequence) return;
          setCatalogModels(page.data);
          setCatalogNextCursor(page.nextCursor);
          setCatalogBusy(false);
        },
        (error: unknown) => {
          if (searchSequence.current !== sequence) return;
          setCatalogModels([]);
          setCatalogNextCursor(null);
          setCatalogError(errorText(error));
          setCatalogBusy(false);
        },
      );
    }, query ? 320 : 0);
    return () => window.clearTimeout(timer);
  }, [catalogQuery, catalogRemoteSort, onSearch]);

  async function loadMoreCatalog() {
    if (!catalogNextCursor || catalogLoadingMore) return;
    const sequence = searchSequence.current;
    setCatalogLoadingMore(true);
    setCatalogError(null);
    try {
      const page = await onSearch({ query: catalogQuery.trim(), cursor: catalogNextCursor, sort: catalogRemoteSort, limit: 20 });
      if (searchSequence.current !== sequence) return;
      setCatalogModels((current) => {
        const known = new Set(current.map((model) => model.id));
        return [...current, ...page.data.filter((model) => !known.has(model.id))];
      });
      setCatalogNextCursor(page.nextCursor);
    } catch (error) {
      if (searchSequence.current === sequence) setCatalogError(errorText(error));
    } finally {
      if (searchSequence.current === sequence) setCatalogLoadingMore(false);
    }
  }

  function selectCatalogModel(model: HubCatalogModel) {
    if (!model.compatible) return;
    setSource(model.id);
    setModelId(networkNameForHubModel(model.id));
    setRevision("");
    setFormError(null);
    setCatalogOpen(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await onRequest({
        id: modelId.trim(),
        source: source.trim(),
        revision: revision.trim() || null,
        contextTokens,
        minimumNodes,
        autoActivate,
      }, adminToken);
    } catch (error) {
      setFormError(friendlyModelMutationError(error));
    } finally {
      setBusy(false);
    }
  }

  return <section className="models-page minimal-screen">
    <PageTitle eyebrow="MODEL FABRIC" title="Models" copy="Choose a compatible Hugging Face model. mycellios calculates the capacity it needs and prepares distribution when nodes are available." />
    <UiForm className="model-request-form" onSubmit={(event) => void submit(event)}>
      <div className="model-form-heading"><div><UiHeading as="h2">Add a model</UiHeading></div><Boxes size={24} /></div>

      <UiDisclosure className="model-advanced model-advanced-top">
        <UiDisclosureSummary><SlidersHorizontal size={15} /> Advanced settings or manual model ID <ChevronDown size={15} /></UiDisclosureSummary>
        <div className="model-form-grid">
          <UiFieldLabel>HUGGING FACE MODEL<UiInput value={source} onChange={(event) => { setSource(event.target.value); setModelId(networkNameForHubModel(event.target.value)); }} placeholder="Qwen/Qwen3-0.6B" required /></UiFieldLabel>
          <UiFieldLabel>NETWORK NAME <small>automatic</small><UiInput value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="qwen3-0.6b" required pattern="[A-Za-z0-9][A-Za-z0-9._-]*" /></UiFieldLabel>
          <UiFieldLabel>REVISION <small>optional</small><UiInput value={revision} onChange={(event) => setRevision(event.target.value)} placeholder="main or commit" /></UiFieldLabel>
          <UiFieldLabel>CONTEXT TOKENS<UiInput type="number" min={128} max={1048576} value={contextTokens} onChange={(event) => setContextTokens(Number(event.target.value))} /></UiFieldLabel>
          <UiFieldLabel>MINIMUM NODES<AppSelect ariaLabel="Minimum nodes" value={String(minimumNodes)} onChange={(value) => setMinimumNodes(Number(value))} options={[2, 3, 4, 5, 6, 7, 8].map((count) => ({ value: String(count), label: String(count) }))} /></UiFieldLabel>
        </div>
      </UiDisclosure>

      {(!source || catalogOpen) && <>
        <div className="hub-catalog-toolbar">
          <div className="hub-model-search"><Search size={17} /><UiInput value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Search every Hugging Face text-generation model…" aria-label="Search Hugging Face models" />{catalogBusy && <LoaderCircle className="spin" />}</div>
          <PanelDisclosure icon={SlidersHorizontal} title="Filters"><div className="hub-filter-options">
          <UiFieldLabel><span>ADAPTER STATUS</span><AppSelect ariaLabel="Filter by adapter status" value={catalogStatus} onChange={(value) => setCatalogStatus(value as typeof catalogStatus)} options={[{ value: "compatible", label: "Runtime compatible" }, { value: "all", label: "All catalog results" }, { value: "unsupported", label: "Needs adapter" }, { value: "gated", label: "License required" }]} /></UiFieldLabel>
          <UiFieldLabel><span>NETWORK FIT</span><AppSelect ariaLabel="Filter by network capacity" value={catalogFit} onChange={(value) => setCatalogFit(value as typeof catalogFit)} options={[{ value: "all", label: "Any size" }, { value: "fits", label: "Fits now" }, { value: "too-large", label: "Needs capacity" }]} /></UiFieldLabel>
          <UiFieldLabel><span>SORT BY</span><AppSelect ariaLabel="Sort Hugging Face models" value={catalogSort} onChange={(value) => setCatalogSort(value as typeof catalogSort)} options={[{ value: "downloads", label: "Most downloaded" }, { value: "likes", label: "Most liked" }, { value: "lastModified", label: "Recently updated" }, { value: "name", label: "Name A–Z" }, { value: "memory", label: "Memory low–high" }]} /></UiFieldLabel>
          </div></PanelDisclosure>
        </div>
        <div className="hub-catalog-heading"><span>{visibleCatalogModels.length} models</span><UiLink href="https://huggingface.co/models?pipeline_tag=text-generation" target="_blank" rel="noreferrer">Explore Hugging Face <ExternalLink size={12} /></UiLink></div>
        {catalogError && <div className="hub-catalog-state error" role="alert"><CircleAlert size={15} />Catalog unavailable. Open Advanced settings above to enter a model ID.</div>}
        {!catalogError && !catalogBusy && catalogModels.length === 0 && <div className="hub-catalog-state">{catalogQuery.trim().length === 1 ? "Type at least two characters to search." : "No matching models found."}</div>}
        {!catalogError && !catalogBusy && catalogModels.length > 0 && visibleCatalogModels.length === 0 && <div className="hub-catalog-state">No loaded models match these filters. Change a filter or load more results.</div>}
        {visibleCatalogModels.length > 0 && <div className="hub-model-table-wrap"><UiTable className="hub-model-table">
          <UiTableHead><UiTableRow><UiTableHeader>Model</UiTableHeader><UiTableHeader>Memory</UiTableHeader><UiTableHeader>Status</UiTableHeader><UiTableHeader><span className="sr-only">Select</span></UiTableHeader></UiTableRow></UiTableHead>
          <UiTableBody>{visibleCatalogModels.map((model) => {
          const estimatedMemoryMiB = estimatedHubMemoryMiB(model);
          const fits = estimatedMemoryMiB !== null && estimatedMemoryMiB <= availableCatalogMemoryMiB;
          const status = model.compatible ? "Certified" : model.gated ? "Gated" : "Not supported";
          return <UiTableRow key={model.id} className={`${source === model.id ? "selected" : ""} ${model.compatible ? "compatible" : "unsupported"}`} title={model.compatibilityReason ?? undefined}>
            <UiTableCell><span className="hub-table-model"><i><Boxes /></i><span><strong>{model.id}</strong><small>{model.author}</small></span></span></UiTableCell>
            <UiTableCell><span className={`hub-table-memory ${fits ? "fits" : ""}`}><MemoryStick />{estimatedMemoryMiB === null ? "Unknown" : `≈ ${formatMemory(estimatedMemoryMiB)}`}</span></UiTableCell>
            <UiTableCell><UiBadge className={`hub-status-pill ${model.compatible ? "certified" : model.gated ? "gated" : "unsupported"}`}>{status}</UiBadge></UiTableCell>
            <UiTableCell><UiButton type="button" className="hub-table-select" disabled={!model.compatible} onClick={() => selectCatalogModel(model)}>{source === model.id ? <><CheckCircle2 /> Selected</> : "Select"}</UiButton></UiTableCell>
          </UiTableRow>;
        })}</UiTableBody></UiTable></div>}
        {catalogModels.length > 0 && <div className="hub-catalog-pagination">{catalogNextCursor ? <UiButton type="button" onClick={() => void loadMoreCatalog()} disabled={catalogLoadingMore}>{catalogLoadingMore ? <LoaderCircle className="spin" /> : <Plus />}{catalogLoadingMore ? "Loading…" : "Load 20 more"}</UiButton> : <em>End of results</em>}</div>}
      </>}

      {source && <div className="hub-selected-model"><CheckCircle2 /><span><small>SELECTED MODEL</small><strong>{source}</strong><em>It will be published as {modelId}{selectedCatalogModel && estimatedHubMemoryMiB(selectedCatalogModel) !== null ? ` · ≈ ${formatMemory(estimatedHubMemoryMiB(selectedCatalogModel)!)} required` : ""}</em></span><UiButton type="button" onClick={() => setCatalogOpen(true)}>Change model</UiButton></div>}

      {requiresAdminToken && <UiFieldLabel className="model-admin-auth"><ShieldCheck /><span><strong>Network administrator authorization</strong><small>Required because preparing a model changes the shared network. {secureTokenStorage ? "Saved with encrypted operating-system storage after successful authorization." : "Kept only for this browser session."}</small></span><UiInput type="password" autoComplete="off" spellCheck={false} value={adminToken} onChange={(event) => { setAdminToken(event.target.value); setFormError(null); }} placeholder="Administrator token" aria-label="Network administrator token" /></UiFieldLabel>}

      <div className="model-submit-row">
        <UiFieldLabel className="model-auto-toggle"><UiInput type="checkbox" checked={autoActivate} onChange={(event) => setAutoActivate(event.target.checked)} /><span><strong>Activate automatically</strong><small>Start as soon as compatible capacity reaches the requirement.</small></span></UiFieldLabel>
        <UiButton className="model-submit" disabled={busy || !source.trim() || !modelId.trim() || (requiresAdminToken && !adminToken.trim())}>{busy ? <LoaderCircle className="spin" /> : <Play size={16} />}{busy ? "Inspecting model…" : "Calculate and prepare"}</UiButton>
      </div>
      {formError && <div className="model-form-error" role="alert"><CircleAlert size={16} />{formError}</div>}
    </UiForm>

    {snapshot.requestedModels.length > 0 && <PanelDisclosure icon={Boxes} title={snapshot.requestedModels.some((model) => model.status === "failed") ? "Requested models · needs attention" : "Requested models"}><div className="model-request-list">
      <div className="model-request-list-heading"><div><strong>Requests</strong></div><small>{snapshot.requestedModels.length} {snapshot.requestedModels.length === 1 ? "model" : "models"}</small></div>
      {snapshot.requestedModels.map((model) => <RequestedModelCard key={model.id} model={model} onRemove={(modelId) => onRemove(modelId, adminToken)} />)}
    </div></PanelDisclosure>}

    <div className="panel-table model-active-table"><div className="panel-table-head"><span>Active model</span><span>Replicas</span><span>Pipelines</span><span>Effective device</span></div>
      {visibleActiveModels.map((model) => {
        const execution = modelExecutionSummary(snapshot, model.id);
        return <div className="panel-table-row model-execution-row" key={model.id}><strong><Boxes size={17} />{model.id}</strong><span>{model.replicas}</span><span>{model.pipelines}</span><ExecutionBadge execution={execution} workers={snapshot.workers} /></div>;
      })}
      {snapshot.models.length === 0 && <Empty icon={Boxes} title="No active models" copy="Choose a model above. It will remain queued with an exact capacity shortfall until the network can run it." />}
    </div>
    {snapshot.models.length > activePageSize && <TablePagination label="active models" page={visibleActivePage} pageCount={activePageCount} total={snapshot.models.length} onPageChange={setActivePage} />}
  </section>;
}

function RequestedModelCard({ model, onRemove }: { model: RequestedModelCapacity; onRemove: (modelId: string) => Promise<void> }) {
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const required = model.requiredVramMiB ?? 0;
  const vramProgress = required > 0 ? model.availableVramMiB / required : 0;
  const nodeProgress = model.requiredNodes > 0 ? model.availableNodes / model.requiredNodes : 0;
  const progress = Math.min(100, Math.round(Math.min(vramProgress, nodeProgress) * 100));
  async function remove() {
    setRemoving(true);
    setRemoveError(null);
    try { await onRemove(model.id); } catch (error) { setRemoveError(friendlyModelMutationError(error)); } finally { setRemoving(false); }
  }
  return <UiCard className={`model-request-card ${model.status}`}>
    <div className="model-request-head"><div className="model-request-icon"><Boxes /></div><div><span>{model.source}</span><UiHeading as="h2">{model.id}</UiHeading><small>{model.adapterId ?? "Checking architecture"}</small></div><ModelStatus status={model.status} /></div>
    <UiText className="model-request-message">{model.status === "failed" ? friendlyActivationFailure(model.message) : model.message}</UiText>
    <div className="model-capacity-bar"><i style={{ width: `${progress}%` }} /></div>
    <div className="model-request-quick"><span><MemoryStick size={14} />{formatMemory(model.availableVramMiB)} available</span><span><Server size={14} />{model.availableNodes} / {model.requiredNodes} nodes</span><span><Activity size={14} />{model.activationProgress?.length ?? 0} events</span></div>
    <UiDisclosure className="model-request-details" onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
      <UiDisclosureSummary><Activity size={15} />Capacity and diagnostics<ChevronDown size={15} /></UiDisclosureSummary>
      {detailsOpen && <div className="model-request-details-body">
      <div className="model-capacity-grid">
        <Metric label="Estimated need" value={model.requiredVramMiB === null ? "Calculating" : formatMemory(model.requiredVramMiB)} />
        <Metric label="Available" value={formatMemory(model.availableVramMiB)} />
        <Metric label="Estimated shortfall" value={model.missingVramMiB === null ? "—" : formatMemory(model.missingVramMiB)} />
        <Metric label="Nodes" value={`${model.availableNodes} / ${model.requiredNodes}`} />
      </div>
      {model.activationIncident && <ActivationIncidentPanel incident={model.activationIncident} />}
      {(model.status === "activating" || model.status === "failed" || (model.activationProgress?.length ?? 0) > 0) && <ActivationProgressLog model={model} />}
      </div>}
    </UiDisclosure>
    {removeError && <div className="model-form-error" role="alert"><CircleAlert size={16} />{removeError}</div>}
    <div className="model-request-foot"><span>{model.autoActivate ? <><Zap size={14} /> Auto-activation armed</> : "Auto-activation off"}</span><UiButton disabled={removing} onClick={() => void remove()}>{removing ? <LoaderCircle className="spin" /> : <Trash2 />} Remove</UiButton></div>
  </UiCard>;
}

function ModelStatus({ status }: { status: RequestedModelCapacity["status"] }) {
  const labels: Record<RequestedModelCapacity["status"], string> = {
    profiling: "Profiling",
    waiting_capacity: "Waiting for capacity",
    ready: "Ready",
    activating: "Activation queued",
    active: "Active",
    incompatible: "Incompatible",
    failed: "Needs attention",
  };
  return <b className={`model-request-status ${status}`}>{status === "profiling" || status === "activating" ? <LoaderCircle className="spin" /> : status === "active" || status === "ready" ? <CheckCircle2 /> : <CircleAlert />}{labels[status]}</b>;
}

function ActivationIncidentPanel({
  incident,
}: {
  incident: NonNullable<RequestedModelCapacity["activationIncident"]>;
}) {
  const repairLabels: Record<typeof incident.repairState, string> = {
    scheduled: "Automatic retry scheduled",
    retrying: "Automatic recovery running",
    exhausted: "Safe retry limit reached",
    manual_required: "Verified change required",
  };
  const automatic = incident.repairState === "scheduled"
    || incident.repairState === "retrying";
  return <aside className={`activation-incident ${incident.repairState}`}>
    <header>
      <span>{automatic ? <RefreshCw className="spin-slow" /> : <ShieldCheck />}</span>
      <div><small>{automatic ? "AUTONOMOUS RECOVERY" : "FAIL-CLOSED DIAGNOSIS"}</small><strong>{incident.title}</strong></div>
      <b>{repairLabels[incident.repairState]}</b>
    </header>
    <UiText>{incident.summary}</UiText>
    <div className="activation-incident-grid">
      <span><small>Scope</small><strong>{incident.scope}</strong></span>
      <span><small>Equipment</small><strong>{incident.nodeId ? shortId(incident.nodeId) : "Not isolated"}</strong></span>
      <span><small>Stage</small><strong>{incident.stageId ? shortId(incident.stageId) : "—"}</strong></span>
      <span><small>Attempt</small><strong>{incident.attempt > 0 ? `${incident.attempt} / ${incident.maximumAttempts}` : "Not retrying"}</strong></span>
    </div>
    <div className="activation-incident-remedy"><Zap /><span><small>SAFE REMEDY</small><strong>{incident.remedy}</strong></span></div>
    <ol>{incident.steps.map((step, index) => <li key={step}><b>{String(index + 1).padStart(2, "0")}</b>{step}</li>)}</ol>
    {incident.nextRetryAt && <footer><Timer />Next bounded attempt: {new Date(incident.nextRetryAt).toLocaleString()}</footer>}
  </aside>;
}

export function Jobs({ snapshot, operatorAccess = false, accessToken = null, getValidSession, apiBaseUrl }: {
  snapshot: PublicSnapshot;
  operatorAccess?: boolean;
  accessToken?: string | null;
  getValidSession?: (forceRefresh?: boolean) => Promise<AuthSession | null>;
  apiBaseUrl?: string;
}) {
  const pageSize = TABLE_PAGE_SIZE;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(snapshot.jobs.length / pageSize));
  const visiblePage = Math.min(page, pageCount - 1);
  const visibleJobs = snapshot.jobs.slice(visiblePage * pageSize, visiblePage * pageSize + pageSize);
  useEffect(() => setPage(0), [snapshot.jobs]);
  const [evidence, setEvidence] = useState<OperatorEvidenceSnapshot | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const loadEvidence = useCallback(async () => {
    if (!operatorAccess || !accessToken) return;
    setEvidenceBusy(true);
    try {
      setEvidence(await loadOperatorEvidence(accessToken, apiBaseUrl));
      setEvidenceError(null);
    } catch (caught) {
      // Supabase sessions can expire or rotate between the identity lookup and
      // this request. Refresh once, then retry with the current access token.
      const message = errorText(caught);
      const shouldRefresh = getValidSession && /invalid_network_token|invalid.*token|session.*valid|unauthorized|401/i.test(message);
      if (shouldRefresh) {
        const refreshed = await getValidSession(true);
        if (refreshed) {
          try {
            setEvidence(await loadOperatorEvidence(refreshed.accessToken, apiBaseUrl));
            setEvidenceError(null);
            return;
          } catch (retryError) {
            setEvidenceError(errorText(retryError));
            return;
          }
        }
      }
      setEvidenceError(message);
    } finally {
      setEvidenceBusy(false);
    }
  }, [accessToken, apiBaseUrl, getValidSession, operatorAccess]);

  useEffect(() => { void loadEvidence(); }, [loadEvidence]);
  const receiptJobs = new Set(evidence?.receipts.map((receipt) => receipt.jobId) ?? []);
  return <section className="jobs-page minimal-screen"><PageTitle eyebrow="EXECUTION LOG" title="Tasks" copy="Recent inference requests and their execution state." />
    <div className="panel-table jobs-table"><div className="panel-table-head"><span>Request</span><span>Model</span><span>Tokens</span><span>Status</span></div>
      {visibleJobs.map((job) => <div className="panel-table-row" key={job.id}><strong><Activity size={16} />{shortId(job.id)}<small>{relativeTime(job.createdAt)}{receiptJobs.has(job.id) ? " · receipt verified" : ""}</small></strong><span data-label="Model">{job.model}</span><span data-label="Tokens">{job.inputTokens + job.outputTokens}</span><b className={job.status} data-label="Status"><i />{job.status}</b></div>)}
      {snapshot.jobs.length === 0 && <Empty icon={Activity} title="No jobs yet" copy="Requests from Mycellios Agent and the API will appear here." />}
    </div>
    {snapshot.jobs.length > pageSize && <TablePagination label="jobs" page={visiblePage} pageCount={pageCount} total={snapshot.jobs.length} onPageChange={setPage} />}
    {operatorAccess && accessToken && <PanelDisclosure icon={ShieldCheck} title="Execution evidence"><OperatorEvidence evidence={evidence} busy={evidenceBusy} error={evidenceError} onRefresh={loadEvidence} /></PanelDisclosure>}
  </section>;
}

function OperatorEvidence({ evidence, busy, error, onRefresh }: {
  evidence: OperatorEvidenceSnapshot | null;
  busy: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
}) {
  return <section className="operator-evidence-console" aria-labelledby="operator-evidence-title" aria-busy={busy}>
    <header><div><small>READ-ONLY · ROLE RESTRICTED</small><UiHeading as="h2" id="operator-evidence-title">Operator evidence</UiHeading><span>Incidents, signed releases, certifications and receipts from canonical stores.</span></div>
      <UiButton type="button" disabled={busy} onClick={() => void onRefresh()}>{busy ? <LoaderCircle className="spin" /> : <RefreshCw />}Refresh</UiButton></header>
    {error && <div className="operator-evidence-error" role="alert"><CircleAlert /><span><strong>Evidence unavailable</strong><small>{error}</small></span></div>}
    {!evidence && busy && <div className="operator-evidence-loading" role="status" aria-live="polite"><LoaderCircle className="spin" />Verifying operational evidence…</div>}
    {evidence && <div className="operator-evidence-grid" aria-live="polite">
      <EvidenceLane title="Incidents" count={evidence.incidents.length} state={evidence.incidents.length ? "attention" : "clear"}>
        {evidence.incidents.slice(0, 4).map(({ modelId, incident }) => <UiCard key={`${modelId}-${incident.code}`}><b>{incident.title}</b><span>{modelId} · {incident.repairState}</span><small>{incident.summary}</small></UiCard>)}
        {evidence.incidents.length === 0 && <UiText>No active activation incidents.</UiText>}
      </EvidenceLane>
      <EvidenceLane title="Releases" count={evidence.releases.items.length} state={evidence.releases.configured ? "clear" : "blocked"}>
        {evidence.releases.items.slice(0, 4).map((release) => <UiCard key={`${release.channel}-${release.platform}-${release.arch}`}><b>{release.channel} · sequence {release.sequence}</b><span>{release.platform}/{release.arch}</span><small>{shortId(release.manifestId)}</small></UiCard>)}
        {evidence.releases.items.length === 0 && <UiText>{evidence.releases.configured ? "No signed manifest published." : "Component release store is not configured."}</UiText>}
      </EvidenceLane>
      <EvidenceLane title="Certifications" count={evidence.certifications.items.length} state={evidence.certifications.configured ? "clear" : "blocked"}>
        {evidence.certifications.items.slice(0, 4).map((certification) => <UiCard key={certification.certificationId}><b>{certification.modelFamily} · {certification.decision}</b><span>{certification.topology} · {certification.platform}/{certification.backend}</span><small>{shortId(certification.certificationId)}</small></UiCard>)}
        {evidence.certifications.items.length === 0 && <UiText>{evidence.certifications.configured ? "No signed model certification published." : "Durable certification registry is not configured."}</UiText>}
      </EvidenceLane>
      <EvidenceLane title="Receipts" count={evidence.receipts.length} state="clear">
        {evidence.receipts.slice(0, 4).map((receipt) => <UiCard key={receipt.receiptId}><b>{shortId(receipt.jobId)} · {receipt.routeClass}</b><span>{receipt.recoveryMode}</span><small>{shortId(receipt.receiptId)}</small></UiCard>)}
        {evidence.receipts.length === 0 && <UiText>No signed execution receipt yet.</UiText>}
      </EvidenceLane>
    </div>}
  </section>;
}

function EvidenceLane({ title, count, state, children }: { title: string; count: number; state: "clear" | "attention" | "blocked"; children: ReactNode }) {
  return <section className={`operator-evidence-lane ${state}`}><header><UiHeading as="h3">{title}</UiHeading><b aria-label={`${count} ${title.toLowerCase()}`}>{count}</b></header><div>{children}</div></section>;
}

type SystemLogFilter = "important" | "errors" | "all";

export function SystemLogs({ snapshot, connectionError }: { snapshot: PublicSnapshot; connectionError: string | null }) {
  const [filter, setFilter] = useState<SystemLogFilter>("important");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const networkLogs = useMemo(
    () => networkSnapshotLogs(snapshot, connectionError),
    [connectionError, snapshot],
  );
  const logSnapshot = networkLogs;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleEntries = logSnapshot.entries.filter((entry) => {
    if (filter === "errors" && entry.level !== "error") return false;
    if (filter === "important" && !importantSystemLog(entry)) return false;
    if (!normalizedQuery) return true;
    return `${entry.event} ${entry.message} ${entry.details ?? ""} ${entry.source}`.toLowerCase().includes(normalizedQuery);
  });
  const warningCount = logSnapshot.entries.filter((entry) => entry.level === "warning").length;
  const errorCount = logSnapshot.entries.filter((entry) => entry.level === "error").length;
  const pageSize = TABLE_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(visibleEntries.length / pageSize));
  const visiblePage = Math.min(page, pageCount - 1);
  const renderedEntries = visibleEntries.slice(visiblePage * pageSize, visiblePage * pageSize + pageSize);

  useEffect(() => setPage(0), [filter, query]);

  return <section className="system-logs-page minimal-screen">
    <PageTitle
      eyebrow="SYSTEM DIAGNOSTICS"
      title="Logs"
      copy="Relevant activity observed from the coordinator, nodes, models, and tasks."
    />
    <SummaryStrip label="Log summary" items={[{ label: "Entries", value: logSnapshot.entries.length }, { label: "Warnings", value: warningCount }, { label: "Errors", value: errorCount }]} />
    <div className="system-log-toolbar">
      <div className="system-log-filters" role="group" aria-label="Filter logs">
        <UiButton className={filter === "important" ? "active" : ""} onClick={() => setFilter("important")}>Important</UiButton>
        <UiButton className={filter === "errors" ? "active" : ""} onClick={() => setFilter("errors")}>Errors only</UiButton>
        <UiButton className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</UiButton>
      </div>
      <UiFieldLabel className="system-log-search"><Search /><UiInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search event, source, or message…" /></UiFieldLabel>
    </div>
    {logSnapshot.truncated && <div className="system-log-notice"><CircleAlert />Only the latest entries are shown to keep the panel responsive and safe.</div>}
    <div className="system-log-list" aria-live="polite">
      {renderedEntries.map((entry) => <SystemLogRow entry={entry} key={entry.id} />)}
      {visibleEntries.length === 0 && <Empty icon={ScrollText} title="No logs match this filter" copy={normalizedQuery ? "Try another search or show all levels." : "No events were recorded at this level."} />}
    </div>
    {visibleEntries.length > pageSize && <TablePagination label="logs" page={visiblePage} pageCount={pageCount} total={visibleEntries.length} onPageChange={setPage} />}
  </section>;
}

function SystemLogRow({ entry }: { entry: SystemLogEntry }) {
  return <UiCard className={`system-log-row ${entry.level}`}>
    <div className="system-log-row-marker"><i /></div>
    <div className="system-log-row-content">
      <header><time dateTime={entry.at}>{formatSystemLogTime(entry.at)}</time><span className={`system-log-level ${entry.level}`}>{systemLogLevelLabel(entry.level)}</span><span className="system-log-source">{systemLogSourceLabel(entry.source)}</span></header>
      <div><strong>{humanizeSystemLogEvent(entry.event)}</strong><UiText>{entry.message}</UiText></div>
      {entry.details && <UiDisclosure><UiDisclosureSummary>Technical details <ChevronDown /></UiDisclosureSummary><code>{entry.details}</code></UiDisclosure>}
    </div>
  </UiCard>;
}

function networkSnapshotLogs(snapshot: PublicSnapshot, connectionError: string | null): SystemLogSnapshot {
  const entries: SystemLogEntry[] = [];
  const capturedAt = snapshot.capturedAt === EMPTY.capturedAt ? new Date().toISOString() : snapshot.capturedAt;
  if (connectionError) {
    entries.push({
      id: `network-error-${capturedAt}`,
      at: capturedAt,
      level: "error",
      source: "coordinator",
      event: "coordinator-unavailable",
      message: redactVisibleLogText(connectionError),
    });
  } else {
    entries.push({
      id: `network-snapshot-${capturedAt}`,
      at: capturedAt,
      level: "info",
      source: "coordinator",
      event: "coordinator-snapshot-ready",
      message: `${snapshot.summary.connected} connected nodes, ${snapshot.models.length} available models and ${snapshot.summary.completedJobs} completed tasks.`,
    });
  }
  for (const worker of snapshot.workers) {
    const state = nodeVisualState(worker);
    entries.push({
      id: `worker-${worker.id}-${worker.lastSeenAt}`,
      at: worker.lastSeenAt,
      level: state === "active" ? "info" : state === "warning" ? "warning" : "error",
      source: "worker",
      event: `worker-${state}`,
      message: `${workerLabel(worker)} · ${nodeStatusLabel(worker)} · ${worker.region}`,
      details: `id=${shortId(worker.id)} · memory=${formatMemory(worker.offeredVramMb)} · tasks=${worker.jobsCompleted}`,
    });
  }
  for (const model of snapshot.requestedModels) {
    entries.push({
      id: `model-${model.id}-${model.status}`,
      at: capturedAt,
      level: model.status === "failed" || model.status === "incompatible" ? "error" : model.status === "waiting_capacity" ? "warning" : "info",
      source: "runtime",
      event: `model-${model.status}`,
      message: redactVisibleLogText(model.message),
      details: model.id,
    });
  }
  for (const job of snapshot.jobs) {
    entries.push({
      id: `job-${job.id}-${job.updatedAt}`,
      at: job.updatedAt,
      level: job.status === "failed" ? "error" : job.failureCode ? "warning" : "info",
      source: "network",
      event: `job-${job.status}`,
      message: `${job.model} · ${job.inputTokens + job.outputTokens} tokens`,
      details: job.failureCode ? redactVisibleLogText(job.failureCode) : `request=${shortId(job.id)}`,
    });
  }
  return {
    capturedAt: new Date().toISOString(),
    entries: entries.sort((left, right) => Date.parse(right.at) - Date.parse(left.at)).slice(0, 300),
    truncated: entries.length > 300,
    source: "network-snapshot",
  };
}

function importantSystemLog(entry: SystemLogEntry): boolean {
  return entry.level !== "info" || /(start|ready|status|update|runtime|coordinator|connected|model|contribution)/i.test(entry.event);
}

function redactVisibleLogText(value: string): string {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/\b(authorization|credential|password|secret|token|api[-_ ]?key)\s*[:=]\s*["']?[^"',}\s]+/gi, "$1=[REDACTED]")
    .replace(/([?&](?:authorization|credential|password|secret|token|api[-_]?key)=)[^&\s]+/gi, "$1[REDACTED]");
}

function formatSystemLogTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function systemLogLevelLabel(level: SystemLogEntry["level"]): string {
  if (level === "error") return "ERROR";
  if (level === "warning") return "WARNING";
  return "INFO";
}

function systemLogSourceLabel(source: SystemLogEntry["source"]): string {
  const labels: Record<SystemLogEntry["source"], string> = {
    desktop: "Application",
    coordinator: "Coordinator",
    worker: "Worker",
    runtime: "Runtime",
    renderer: "Interface",
    network: "Network",
  };
  return labels[source];
}

function humanizeSystemLogEvent(event: string): string {
  return event.replace(/[-_.]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Tests({ canRunLocally, loadBenchmarkRuns = fetchBenchmarkRuns }: { canRunLocally: boolean; loadBenchmarkRuns?: typeof fetchBenchmarkRuns }) {
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [comparisonRunId, setComparisonRunId] = useState("");
  const [filters, setFilters] = useState<BenchmarkFilters>(EMPTY_BENCHMARK_FILTERS);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadInFlight = useRef(false);

  const loadRuns = useCallback(async (silent = false) => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    if (!silent) setLoading(true);
    try {
      const next = await loadBenchmarkRuns();
      setRuns(next);
      setSelectedRunId((current) => next.some((run) => run.runId === current) ? current : next[0]?.runId ?? "");
      setError(null);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      loadInFlight.current = false;
      if (!silent) setLoading(false);
    }
  }, [loadBenchmarkRuns]);

  useEffect(() => {
    void loadRuns();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadRuns(true); }, 5_000);
    return () => window.clearInterval(timer);
  }, [loadRuns]);

  async function runNow() {
    setRunning(true);
    setError(null);
    try {
      const run = await requestBenchmarkRun();
      setRuns((current) => [run, ...current.filter((item) => item.runId !== run.runId)]);
      setSelectedRunId(run.runId);
      setComparisonRunId("");
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setRunning(false);
    }
  }

  function selectRun(runId: string) {
    setSelectedRunId(runId);
    setComparisonRunId("");
  }

  function updateFilter<Key extends keyof BenchmarkFilters>(
    key: Key,
    value: BenchmarkFilters[Key],
  ) {
    const nextFilters = { ...filters, [key]: value };
    const nextRuns = filterBenchmarkRuns(runs, nextFilters);
    setFilters(nextFilters);
    setSelectedRunId((current) =>
      nextRuns.some((run) => run.runId === current) ? current : nextRuns[0]?.runId ?? ""
    );
    setComparisonRunId("");
  }

  const filterValues = benchmarkFilterValues(runs);
  const filteredRuns = filterBenchmarkRuns(runs, filters);
  const selected = filteredRuns.find((run) => run.runId === selectedRunId)
    ?? filteredRuns[0]
    ?? null;
  const selectedSnapshot = benchmarkRunSnapshot(selected);
  const trendRuns = benchmarkTrendRuns(selected, filteredRuns);
  const comparableMeasurements = trendRuns
    .flatMap((run) => run.measurements)
    .filter((measurement) =>
      !selectedSnapshot
      || measurement.scenarioFingerprint === selectedSnapshot.scenarioFingerprint
    );
  const bestThroughput = comparableMeasurements.reduce<number | null>((best, item) => {
    const value = item.metrics.tokensPerSecondP50 ?? item.metrics.tokensPerSecond;
    return value === null ? best : best === null ? value : Math.max(best, value);
  }, null);
  const selectedMeasurement = selectedSnapshot?.measurement ?? null;
  const selectedInventory = selectedMeasurement?.inventory ?? null;
  const selectedNodes = selectedInventory?.selectedDevices ?? 0;
  const selectedOfferedGb = selectedInventory?.offeredMemoryGb
    ?? nullableBenchmarkSum(selectedInventory?.profiles
      .filter((profile) => profile.kind === "gpu")
      .map((profile) => profile.offeredMemoryGb ?? profile.memoryGb) ?? []);
  const selectedPower = selectedMeasurement?.metrics.powerWattsP50
    ?? selectedInventory?.observedPowerWatts
    ?? nullableBenchmarkSum(selectedInventory?.profiles.map((profile) => profile.observedPowerWatts) ?? []);
  const selectedPowerLimit = selectedInventory?.powerLimitWatts
    ?? nullableBenchmarkSum(selectedInventory?.profiles.map((profile) => profile.powerLimitWatts) ?? []);
  const automaticBaseline = defaultBenchmarkBaseline(selected, filteredRuns);
  const comparisonRun = filteredRuns.find((run) => run.runId === comparisonRunId && run.runId !== selected?.runId)
    ?? automaticBaseline;
  const comparison = compareBenchmarkRuns(selected, comparisonRun);
  const runOptions = filteredRuns.map((run) => {
    const snapshot = benchmarkRunSnapshot(run);
    return {
      value: run.runId,
      label: `${run.trigger === "automatic-model-start" ? "Auto" : "Manual"} · ${snapshot?.measurement.model.label ?? run.triggerModelId ?? "model"} · v${run.version} · ${formatBenchmarkDate(run.finishedAt)}`,
    };
  });
  const comparisonOptions = [
    { value: "", label: "No comparable reference" },
    ...filteredRuns.filter((run) => run.runId !== selected?.runId).map((run) => {
      const snapshot = benchmarkRunSnapshot(run);
      const comparable = snapshot?.scenarioFingerprint === selectedSnapshot?.scenarioFingerprint
        && snapshot?.scenarioComparable === true;
      return {
        value: run.runId,
        label: `${comparable ? "Comparable" : "Different configuration"} · ${snapshot?.measurement.model.label ?? "model"} · ${snapshot ? snapshot.nodes : "No reading"} nodes · v${run.version}`,
      };
    }),
  ];

  return <section className="tests-page minimal-screen">
    <PageTitle eyebrow="AUTOMATED BENCHMARKS" title="Performance" copy="Compare speed, latency and efficiency across matching models, workloads and hardware." actions={canRunLocally ? <UiButton disabled={running} onClick={() => void runNow()}>{running ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}{running ? "Measuring…" : "Run test again"}</UiButton> : undefined} />
    {error && <div className="benchmark-error" role="alert"><CircleAlert size={17} /><span><strong>Test failed</strong>{error}</span></div>}
    <SummaryStrip label="Test summary" items={[{ label: "Saved tests", value: filteredRuns.length }, { label: "Best speed P50", value: formatBenchmark(bestThroughput, " tok/s") }, { label: "First token P95", value: formatBenchmark(selectedMeasurement?.metrics.ttftMsP95 ?? null, " ms") }]} />
    {selectedMeasurement && <PanelDisclosure icon={Gauge} title="Measurement details"><div className="benchmark-capacity-strip">
      <BenchmarkMetric icon={MemoryStick} label="Offered memory" value={formatBenchmark(selectedOfferedGb, " GB")} detail={formatBenchmark(selectedInventory?.physicalMemoryGb ?? null, " physical GB")} />
      <BenchmarkMetric icon={Zap} label="P50 power" value={selectedPower === null ? "No reading" : formatPower(selectedPower)} detail={`P95 ${formatPowerReading(selectedMeasurement.metrics.powerWattsP95 ?? null)} · peak ${formatPowerReading(selectedMeasurement.metrics.powerWattsPeak ?? null)}`} />
      <BenchmarkMetric icon={Gauge} label="Speed P50" value={formatBenchmark(selectedMeasurement.metrics.tokensPerSecondP50 ?? selectedMeasurement.metrics.tokensPerSecond, " tok/s")} detail={`P5 ${formatBenchmark(selectedMeasurement.metrics.tokensPerSecondP5 ?? null, " tok/s")} · P95 ${formatBenchmark(selectedMeasurement.metrics.tokensPerSecondP95, " tok/s")}`} />
      <BenchmarkMetric icon={Timer} label="First token P95" value={formatBenchmark(selectedMeasurement.metrics.ttftMsP95, " ms")} detail={`P50 ${formatBenchmark(selectedMeasurement.metrics.ttftMsP50, " ms")}`} />
      <BenchmarkMetric icon={ShieldCheck} label="Statistical confidence" value={benchmarkStabilityLabel(selectedMeasurement)} detail={`CV ${formatBenchmark(selectedMeasurement.metrics.coefficientOfVariationPct ?? null, "%")} · ±${formatBenchmark(selectedMeasurement.metrics.confidenceHalfWidthPct ?? null, "%")}`} />
      <BenchmarkMetric icon={Activity} label="Measured energy" value={formatBenchmark(selectedMeasurement.metrics.energyWh ?? null, " Wh")} detail={`Coverage ${formatBenchmark(selectedMeasurement.metrics.energyCoveragePct ?? null, "%")}`} />
    </div></PanelDisclosure>}
    {loading && runs.length === 0 ? <div className="benchmark-loading"><LoaderCircle className="spin" /><span>Loading real history…</span></div> : runs.length === 0 ? <Empty icon={Gauge} title="No real tests yet" copy="Start a model. The first measurement is saved automatically when a physical route is available." /> : <>
      <PanelDisclosure icon={SlidersHorizontal} title="Filter tests"><BenchmarkFiltersPanel
        filters={filters}
        values={filterValues}
        visibleCount={filteredRuns.length}
        onChange={updateFilter}
        onClear={() => {
          setFilters(EMPTY_BENCHMARK_FILTERS);
          setSelectedRunId(runs[0]?.runId ?? "");
          setComparisonRunId("");
        }}
      /></PanelDisclosure>
      {filteredRuns.length === 0 ? <Empty icon={Search} title="No tests match these filters" copy="Change one filter to see the saved real history again." /> : <>
      <div className="benchmark-toolbar">
        <div className="benchmark-toolbar-selects">
          <UiFieldLabel>CURRENT RESULT<AppSelect ariaLabel="Current result" value={selected?.runId ?? ""} onChange={selectRun} options={runOptions} /></UiFieldLabel>
          <UiFieldLabel>COMPARE WITH<AppSelect ariaLabel="Reference result" value={comparisonRun?.runId ?? ""} onChange={setComparisonRunId} options={comparisonOptions} /></UiFieldLabel>
        </div>
        {selected && <div className={`benchmark-run-state ${selected.status}`}><i />{benchmarkStatusLabel(selected.status)}<span>{selected.trigger === "automatic-model-start" ? "automatic start" : selected.suite === "physical-import" ? "physical campaign" : "manual test"}</span></div>}
      </div>
      {comparisonRun && <BenchmarkComparisonPanel comparison={comparison} />}
      <div className="benchmark-chart-grid">
        <BenchmarkTrend runs={trendRuns} metric="tokensPerSecond" label="Speed P50 and P5–P95 range" unit="tok/s" tone="blue" />
        <BenchmarkTrend runs={trendRuns} metric="ttftMsP95" label="First token P95" unit="ms" tone="purple" />
      </div>
      <PanelDisclosure icon={Activity} title="More charts"><div className="benchmark-chart-grid">
        <BenchmarkTrend runs={trendRuns} metric="nodes" label="Nodes used" unit=" nodes" tone="green" />
        <BenchmarkTrend runs={trendRuns} metric="tokensPerSecondPerNode" label="Speed per node" unit=" tok/s/node" tone="orange" />
      </div></PanelDisclosure>
      <PanelDisclosure icon={History} title="Saved tests"><BenchmarkHistory runs={filteredRuns} selectedRunId={selected?.runId ?? ""} onSelect={selectRun} /></PanelDisclosure>
      {selected && <PanelDisclosure icon={FileText} title="Result details"><BenchmarkRunDetails run={selected} /></PanelDisclosure>}
      </>}
    </>}
  </section>;
}

function BenchmarkFiltersPanel({
  filters,
  values,
  visibleCount,
  onChange,
  onClear,
}: {
  filters: BenchmarkFilters;
  values: ReturnType<typeof benchmarkFilterValues>;
  visibleCount: number;
  onChange: (key: keyof BenchmarkFilters, value: string) => void;
  onClear: () => void;
}) {
  const activeFilters = Object.values(filters).filter(Boolean).length;
  return <section className="benchmark-filters" aria-label="Benchmark filters">
    <div className="benchmark-filters-heading">
      <div><SlidersHorizontal size={19} /><span><strong>Filter tests</strong><small>{visibleCount} visible result{visibleCount === 1 ? "" : "s"}</small></span></div>
      <UiButton type="button" className="benchmark-clear-filters" disabled={activeFilters === 0} onClick={onClear}>Clear filters{activeFilters > 0 ? ` (${activeFilters})` : ""}</UiButton>
    </div>
    <div className="benchmark-filter-grid">
      <UiFieldLabel>MODEL<AppSelect ariaLabel="Filter by model" value={filters.model} onChange={(value) => onChange("model", value)} options={[{ value: "", label: "All models" }, ...values.models]} /></UiFieldLabel>
      <UiFieldLabel>VERSION<AppSelect ariaLabel="Filter by version" value={filters.version} onChange={(value) => onChange("version", value)} options={[{ value: "", label: "All versions" }, ...values.versions.map((version) => ({ value: version, label: `v${version}` }))]} /></UiFieldLabel>
      <UiFieldLabel>STATUS<AppSelect ariaLabel="Filter by status" value={filters.status} onChange={(value) => onChange("status", value)} options={[{ value: "", label: "All statuses" }, ...values.statuses.map((status) => ({ value: status, label: benchmarkStatusLabel(status) }))]} /></UiFieldLabel>
      <UiFieldLabel>BACKEND<AppSelect ariaLabel="Filter by backend" value={filters.backend} onChange={(value) => onChange("backend", value)} options={[{ value: "", label: "All backends" }, ...values.backends.map((backend) => ({ value: backend, label: backend === "__without_reading__" ? "No reading" : backend.toUpperCase() }))]} /></UiFieldLabel>
      <UiFieldLabel>EVIDENCE<AppSelect ariaLabel="Filter by evidence" value={filters.evidence} onChange={(value) => onChange("evidence", value)} options={[{ value: "", label: "All evidence" }, ...values.evidence.map((evidence) => ({ value: evidence, label: evidence === "physical" ? "Real physical" : "Local loopback" }))]} /></UiFieldLabel>
    </div>
  </section>;
}

type BenchmarkTrendMetric = "tokensPerSecond" | "ttftMsP95" | "nodes" | "tokensPerSecondPerNode";

function BenchmarkTrend({ runs, metric, label, unit, tone }: { runs: BenchmarkRun[]; metric: BenchmarkTrendMetric; label: string; unit: string; tone: "blue" | "purple" | "green" | "orange" }) {
  const chronological = [...runs].reverse();
  const points = chronological.map((run) => {
    const snapshot = benchmarkRunSnapshot(run);
    if (!snapshot) return null;
    const value = benchmarkSnapshotMetric(snapshot, metric);
    if (value === null) return null;
    const low = metric === "tokensPerSecond" ? snapshot.tokensPerSecondP5 : null;
    const high = metric === "tokensPerSecond" ? snapshot.tokensPerSecondP95 : null;
    return { run, snapshot, value, low, high };
  }).filter((point): point is NonNullable<typeof point> => point !== null);
  const values = points.flatMap((point) => [
    point.value,
    point.low ?? point.value,
    point.high ?? point.value,
  ]);
  const width = 720; const height = 240; const left = 52; const right = 30; const top = 28; const bottom = 50;
  const ceiling = Math.max(...values, 1);
  const x = (index: number) => points.length === 1 ? (left + width - right) / 2 : left + (index / Math.max(points.length - 1, 1)) * (width - left - right);
  const y = (value: number) => top + (1 - value / ceiling) * (height - top - bottom);
  return <UiCard className="benchmark-chart">
    <div><span>SAME FINGERPRINT · {points[0]?.snapshot.measurement.model.label ?? "NO DATA"}</span><UiHeading as="h2">{label}</UiHeading></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}. ${points.length} real test${points.length === 1 ? "" : "s"}.`}>
      <line className="benchmark-axis" x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} />
      {[0, 0.5, 1].map((ratio) => <g key={ratio}><line className="benchmark-grid-line" x1={left} y1={top + ratio * (height - top - bottom)} x2={width - right} y2={top + ratio * (height - top - bottom)} /><text x={left - 8} y={top + ratio * (height - top - bottom) + 4} textAnchor="end">{formatBenchmark(ceiling * (1 - ratio), "")}</text></g>)}
      {metric === "tokensPerSecond" && points.length > 1 && points.every((point) => point.low !== null && point.high !== null) && <polygon
        className="benchmark-confidence-band"
        points={[
          ...points.map((point, index) => `${x(index)},${y(point.high ?? point.value)}`),
          ...[...points].reverse().map((point, reverseIndex) => `${x(points.length - 1 - reverseIndex)},${y(point.low ?? point.value)}`),
        ].join(" ")}
      />}
      <g className={`benchmark-series tone-${tone}`}>
        {points.length > 1 && <polyline points={points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ")} />}
        {metric === "tokensPerSecond" && points.map((point, index) =>
          point.low === null || point.high === null ? null : <line
            className="benchmark-range"
            key={`range-${point.run.runId}`}
            x1={x(index)}
            x2={x(index)}
            y1={y(point.low)}
            y2={y(point.high)}
          />
        )}
        {points.map((point, index) => <circle key={point.run.runId} cx={x(index)} cy={y(point.value)} r="5"><title>{`v${point.run.version} · ${formatBenchmarkDate(point.run.finishedAt)}: ${formatBenchmark(point.value, ` ${unit}`)}${point.low === null || point.high === null ? " · interval: No reading" : ` · P5 ${formatBenchmark(point.low, ` ${unit}`)} · P95 ${formatBenchmark(point.high, ` ${unit}`)}`}`}</title></circle>)}
      </g>
      {points.map((point, index) => {
        const labelEvery = Math.max(1, Math.ceil(points.length / 6));
        if (index % labelEvery !== 0 && index !== points.length - 1) return null;
        return <text className="benchmark-x-label" key={point.run.runId} x={x(index)} textAnchor="middle">
          <tspan x={x(index)} y={height - 23}>v{point.run.version}</tspan>
          <tspan x={x(index)} y={height - 9}>{formatBenchmarkChartTime(point.run.finishedAt)}</tspan>
        </text>;
      })}
    </svg>
    <div className="benchmark-chart-summary"><span>{points.length} matching measurement{points.length === 1 ? "" : "s"}{metric === "tokensPerSecond" ? " · P5–P95 range" : ""}</span><strong>{formatBenchmark(points.at(-1)?.value ?? null, ` ${unit}`)}</strong></div>
  </UiCard>;
}

function BenchmarkComparisonPanel({ comparison }: { comparison: BenchmarkRunComparison }) {
  const copy = benchmarkComparisonNarrative(comparison);
  return <UiCard className={`benchmark-comparison ${comparison.mode} ${comparison.verdict}`}>
    <div className="benchmark-comparison-heading">
      <div><span>{copy.eyebrow}</span><UiHeading as="h2">{copy.title}</UiHeading><UiText>{copy.description}</UiText></div>
      {comparison.current && comparison.baseline && <div className="benchmark-comparison-versions">
        <span><small>REFERENCE</small><strong>v{comparison.baseline.run.version}</strong><em>rev {benchmarkBuildRevision(comparison.baseline.run)}</em></span>
        <ArrowRight size={17} />
        <span><small>CURRENT</small><strong>v{comparison.current.run.version}</strong><em>rev {benchmarkBuildRevision(comparison.current.run)}</em></span>
      </div>}
    </div>
    <div className="benchmark-comparison-grid">
      <BenchmarkComparisonMetric
        label="Speed"
        baseline={formatBenchmark(comparison.baseline?.tokensPerSecond ?? null, " tok/s")}
        current={formatBenchmark(comparison.current?.tokensPerSecond ?? null, " tok/s")}
        baselineDetail={formatBenchmarkRange(comparison.baseline)}
        currentDetail={formatBenchmarkRange(comparison.current)}
        delta={comparison.speedChangePct}
        claim={comparison.verdict === "faster-code-signal" || comparison.verdict === "slower-code-signal"}
      />
      <BenchmarkComparisonMetric
        label="First token P95"
        baseline={formatBenchmark(comparison.baseline?.ttftMsP95 ?? null, " ms")}
        current={formatBenchmark(comparison.current?.ttftMsP95 ?? null, " ms")}
        delta={comparison.latencyImprovementPct}
      />
      <BenchmarkComparisonMetric
        label="Nodes used"
        baseline={comparison.baseline ? String(comparison.baseline.nodes) : "No reading"}
        current={comparison.current ? String(comparison.current.nodes) : "No reading"}
        rawDelta={formatSignedBenchmark(comparison.nodesDelta, "")}
        neutral
      />
      <BenchmarkComparisonMetric
        label="Speed per node"
        baseline={formatBenchmark(comparison.baseline?.tokensPerSecondPerNode ?? null, " tok/s")}
        current={formatBenchmark(comparison.current?.tokensPerSecondPerNode ?? null, " tok/s")}
        delta={comparison.efficiencyPerNodeChangePct}
      />
      <BenchmarkComparisonMetric
        label="Speed per GB"
        baseline={formatBenchmark(comparison.baseline?.tokensPerSecondPerGb ?? null, " tok/s/GB")}
        current={formatBenchmark(comparison.current?.tokensPerSecondPerGb ?? null, " tok/s/GB")}
        delta={comparison.efficiencyPerGbChangePct}
      />
      <BenchmarkComparisonMetric
        label="Speed per watt"
        baseline={formatBenchmark(comparison.baseline?.tokensPerSecondPerWatt ?? null, " tok/s/W")}
        current={formatBenchmark(comparison.current?.tokensPerSecondPerWatt ?? null, " tok/s/W")}
        delta={comparison.efficiencyPerWattChangePct}
      />
    </div>
  </UiCard>;
}

function BenchmarkComparisonMetric({ label, baseline, current, baselineDetail, currentDetail, delta = null, rawDelta, neutral = false, claim = false }: {
  label: string;
  baseline: string;
  current: string;
  baselineDetail?: string;
  currentDetail?: string;
  delta?: number | null;
  rawDelta?: string;
  neutral?: boolean;
  claim?: boolean;
}) {
  const tone = delta === null && rawDelta === undefined
    ? "unavailable"
    : neutral || !claim
      ? "neutral"
      : (delta ?? 0) >= 0 ? "positive" : "negative";
  const deltaLabel = rawDelta ?? (delta === null
    ? "No comparison"
    : claim
      ? delta >= 0 ? `+${delta.toFixed(1)}% better` : `${delta.toFixed(1)}% worse`
      : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}% observed`);
  return <div className="benchmark-comparison-metric">
    <small>{label}</small>
    <div><span><em>Before</em><strong>{baseline}</strong>{baselineDetail && <small>{baselineDetail}</small>}</span><ArrowRight size={14} /><span><em>Now</em><strong>{current}</strong>{currentDetail && <small>{currentDetail}</small>}</span></div>
    <b className={tone}>{deltaLabel}</b>
  </div>;
}

function BenchmarkHistory({ runs, selectedRunId, onSelect }: { runs: BenchmarkRun[]; selectedRunId: string; onSelect: (runId: string) => void }) {
  const [page, setPage] = useState(0);
  const pageSize = TABLE_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(runs.length / pageSize));
  const visiblePage = Math.min(page, pageCount - 1);
  const visibleRuns = runs.slice(visiblePage * pageSize, visiblePage * pageSize + pageSize);
  useEffect(() => setPage(0), [runs]);
  return <UiCard className="benchmark-history">
    <div className="card-heading"><div><span>EVOLUTION HISTORY</span><UiHeading as="h2">All real tests</UiHeading></div><small>{runs.length} test{runs.length === 1 ? "" : "s"} · select a row</small></div>
    <div className="benchmark-history-table">
      <div className="benchmark-history-head"><span>Version / build</span><span>Model / evidence</span><span>Nodes / topology</span><span>Capacity</span><span>P50 speed</span><span>Confidence</span><span>Status</span></div>
      {visibleRuns.map((run) => {
        const snapshot = benchmarkRunSnapshot(run);
        if (!snapshot) return null;
        return <UiButton className={`benchmark-history-row ${run.runId === selectedRunId ? "selected" : ""}`} aria-pressed={run.runId === selectedRunId} key={run.runId} onClick={() => onSelect(run.runId)}>
          <span data-label="Version / build"><strong>v{run.version}</strong><small>rev {benchmarkBuildRevision(run)} · src {shortSourceId(run.build.sourceId)} · {formatBenchmarkDate(run.finishedAt)}</small></span>
          <span data-label="Model / evidence"><strong>{snapshot.measurement.model.label}</strong><small>{snapshot.measurement.evidence === "physical" ? "Real physical" : "Loopback"} · {formatBenchmarkBackend(snapshot.measurement)}</small></span>
          <span data-label="Nodes / topology"><strong>{snapshot.nodes}</strong><small>{formatTopologyDigest(snapshot.measurement.topology.digest)}</small></span>
          <span data-label="Capacity"><strong>{formatBenchmark(snapshot.offeredMemoryGb, " GB")}</strong><small>{formatBenchmark(snapshot.measurement.inventory.physicalMemoryGb ?? null, " physical GB")}</small></span>
          <span data-label="P50 speed"><strong>{formatBenchmark(snapshot.tokensPerSecondP50, " tok/s")}</strong><small>{formatBenchmarkRange(snapshot)}</small></span>
          <span data-label="Confidence"><strong>{benchmarkStabilityLabel(snapshot.measurement)}</strong><small>CV {formatBenchmark(snapshot.coefficientOfVariationPct, "%")} · TTFT {formatBenchmark(snapshot.ttftMsP95, " ms")}</small></span>
          <span data-label="Status"><b className={run.status}><i />{benchmarkStatusLabel(run.status)}</b><ChevronRight size={15} /></span>
        </UiButton>;
      })}
    </div>
    {runs.length > pageSize && <TablePagination label="benchmark tests" page={visiblePage} pageCount={pageCount} total={runs.length} onPageChange={setPage} />}
  </UiCard>;
}

function BenchmarkRunDetails({ run }: { run: BenchmarkRun }) {
  return <div className="benchmark-results">
    <div className="card-heading"><div><span>SELECTED RESULT</span><UiHeading as="h2">{run.triggerModelId ?? run.label}</UiHeading></div><small>v{run.version} · review {benchmarkBuildRevision(run)} · local source {shortSourceId(run.build.sourceId)} · node-declared sources {run.build.participantSourceIds.map(shortSourceId).join(", ") || "undeclared"} · {benchmarkDirtyLabel(run.gitDirty)}</small></div>
    <div className="benchmark-result-list">
      {run.measurements.map((measurement) => <BenchmarkResultCard measurement={measurement} run={run} key={measurement.id} />)}
    </div>
  </div>;
}

function BenchmarkResultCard({ measurement, run }: { measurement: BenchmarkMeasurement; run: BenchmarkRun }) {
  const delta = measurement.comparison.tokensPerSecondPct;
  const physicalMemory = measurement.inventory.physicalMemoryGb
    ?? nullableBenchmarkSum(measurement.inventory.profiles
      .filter((profile) => profile.kind === "gpu")
      .map((profile) => profile.physicalMemoryGb));
  const offeredMemory = measurement.inventory.offeredMemoryGb
    ?? nullableBenchmarkSum(measurement.inventory.profiles
      .filter((profile) => profile.kind === "gpu")
      .map((profile) => profile.offeredMemoryGb ?? profile.memoryGb));
  const power = measurement.metrics.powerWattsP50
    ?? measurement.inventory.observedPowerWatts
    ?? nullableBenchmarkSum(measurement.inventory.profiles.map((profile) => profile.observedPowerWatts));
  const powerLimit = measurement.inventory.powerLimitWatts
    ?? nullableBenchmarkSum(measurement.inventory.profiles.map((profile) => profile.powerLimitWatts));
  const temperaturePeak = measurement.metrics.temperatureCPeak
    ?? nullableBenchmarkMax(measurement.inventory.profiles.map((profile) => profile.temperatureC));
  return <UiCard className="benchmark-result-card">
    <div className="benchmark-result-heading">
      <div><span className="benchmark-result-icon"><Gauge size={18} /></span><span><small>{measurement.evidence === "physical" ? "REAL PHYSICAL EVIDENCE" : "REAL LOCAL RUNTIME"}</small><strong>{measurement.model.label}</strong><em>{measurement.model.precision} · model rev {measurement.model.revision?.slice(0, 12) ?? "No reading"} · build rev {benchmarkBuildRevision(run)}</em></span></div>
      <b className={measurement.status}><i />{benchmarkStatusLabel(measurement.status)}</b>
    </div>
    <div className="benchmark-result-metrics">
      <BenchmarkValue label="Nodes used" value={String(measurement.inventory.selectedDevices)} detail={`${measurement.inventory.connectedDevices}/${measurement.inventory.totalDevices} connected`} />
      <BenchmarkValue label="Offered VRAM" value={formatBenchmark(offeredMemory, " GB")} detail={formatBenchmark(physicalMemory, " physical GB")} />
      <BenchmarkValue label="P50 power" value={formatPowerReading(power)} detail={`P95 ${formatPowerReading(measurement.metrics.powerWattsP95 ?? null)} · peak ${formatPowerReading(measurement.metrics.powerWattsPeak ?? null)}${powerLimit === null ? "" : ` · limit ${formatPower(powerLimit)}`}`} />
      <BenchmarkValue label="Tokens / second P50" value={formatBenchmark(measurement.metrics.tokensPerSecondP50 ?? measurement.metrics.tokensPerSecond, " tok/s")} detail={`P5 ${formatBenchmark(measurement.metrics.tokensPerSecondP5 ?? null, " tok/s")} · P95 ${formatBenchmark(measurement.metrics.tokensPerSecondP95, " tok/s")}`} accent />
      <BenchmarkValue label="First token" value={formatBenchmark(measurement.metrics.ttftMsP95, " ms")} detail={`P50 ${formatBenchmark(measurement.metrics.ttftMsP50, " ms")}`} />
      <BenchmarkValue label="Stability" value={benchmarkStabilityLabel(measurement)} detail={`CV ${formatBenchmark(measurement.metrics.coefficientOfVariationPct ?? null, "%")} · CI ±${formatBenchmark(measurement.metrics.confidenceHalfWidthPct ?? null, "%")}`} tone={measurement.workload.statisticallyStable === false ? "negative" : measurement.workload.statisticallyStable === true ? "positive" : ""} />
      <BenchmarkValue label="Energy" value={formatBenchmark(measurement.metrics.energyWh ?? null, " Wh")} detail={`Coverage ${formatBenchmark(measurement.metrics.energyCoveragePct ?? null, "%")} · ${formatBenchmark(measurement.metrics.energyWhPerToken, " Wh/token")}`} />
      <BenchmarkValue label="Peak temperature" value={formatBenchmark(temperaturePeak, " °C")} detail={`Peak used memory ${formatBenchmark(measurement.metrics.usedMemoryGbPeak ?? null, " GB")}`} />
      <BenchmarkValue label="Saved change" value={delta === null ? "No comparison" : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%`} detail={measurement.comparison.baselineRunId ? "Only valid with an identical fingerprint" : "No comparable run"} tone={delta === null ? "" : delta < 0 ? "negative" : "positive"} />
    </div>
    <div className="benchmark-node-list">
      {measurement.inventory.profiles.map((profile) => <span key={profile.nodeId ?? profile.label}><Server size={16} /><strong>{profile.label}</strong><small>{profile.backend ?? "No reading"} · {formatBenchmark(profile.offeredMemoryGb ?? profile.memoryGb, " GB")} · GPU {formatBenchmark(profile.utilizationPct ?? null, "%")} · {formatPowerReading(profile.observedPowerWatts ?? null)} · {formatBenchmark(profile.temperatureC ?? null, " °C")}</small></span>)}
    </div>
    <div className="benchmark-topology-summary">
      <div><Network size={18} /><span><small>OBSERVED TOPOLOGY</small><strong>{measurement.topology.stageCount === null ? "No reading" : `${measurement.topology.stageCount} stages`} · {formatTopologyDigest(measurement.topology.digest)}</strong></span></div>
      <dl>
        <div><dt>Route nodes</dt><dd>{measurement.topology.nodeIds.length > 0 ? measurement.topology.nodeIds.map(shortId).join(" → ") : "No reading"}</dd></div>
        <div><dt>Layer boundaries</dt><dd>{measurement.topology.boundaries.length > 0 ? measurement.topology.boundaries.join(" · ") : "No reading"}</dd></div>
        <div><dt>Route classes</dt><dd>{measurement.topology.routeClasses.length > 0 ? measurement.topology.routeClasses.join(" · ") : "No reading"}</dd></div>
      </dl>
    </div>
    <BenchmarkNetworkTrace traces={measurement.networkTraces ?? []} />
    <UiDisclosure className="benchmark-technical-details">
      <UiDisclosureSummary>View all metrics for this test</UiDisclosureSummary>
      <div>
        <BenchmarkValue label="Valid requests" value={`${formatCountReading(measurement.workload.successfulRequests)} / ${formatCountReading(measurement.workload.requests)}`} detail={`Success ${formatRate(measurement.metrics.requestSuccessRate ?? null)}`} />
        <BenchmarkValue label="Warmup" value={formatCountReading(measurement.workload.warmupRequests)} detail={`${formatCountReading(measurement.workload.recoveredFailures)} failures recovered`} />
        <BenchmarkValue label="Observed tokens" value={formatCountReading(measurement.workload.observedOutputTokens)} detail={`${measurement.workload.outputTokens} requested per call`} />
        <BenchmarkValue label="Total duration" value={formatBenchmark(measurement.workload.durationMs ?? null, " ms")} detail={`P95 latency ${formatBenchmark(measurement.metrics.latencyMsP95 ?? null, " ms")}`} />
        <BenchmarkValue label="Time per token" value={formatBenchmark(measurement.metrics.tpotMsP95, " ms")} detail={`P50 ${formatBenchmark(measurement.metrics.tpotMsP50, " ms")}`} />
        <BenchmarkValue label="Aggregate speed" value={formatBenchmark(measurement.metrics.aggregateTokensPerSecond, " tok/s")} detail={(measurement.workload.routeClasses ?? []).join(", ") || "No completed route"} />
        <BenchmarkValue label="Exactness" value={formatRate(measurement.metrics.exactnessRate ?? null)} detail={`Consistency ${formatRate(measurement.metrics.deterministicConsistencyRate ?? null)}`} />
        <BenchmarkValue label="Accepted speculation" value={formatRate(measurement.metrics.speculativeAcceptanceRate ?? null)} detail={`Inherited acceptance ${formatRate(measurement.metrics.acceptanceRate)}`} />
        <BenchmarkValue label="P50 GPU usage" value={formatBenchmark(measurement.metrics.utilizationPctP50 ?? null, "%")} detail={`P95 ${formatBenchmark(measurement.metrics.utilizationPctP95 ?? null, "%")}`} />
        <BenchmarkValue label="Campaign end" value={benchmarkCampaignStopLabel(measurement.workload.campaignStopReason)} detail={measurement.scenarioFingerprint ? measurement.scenarioFingerprint.slice(0, 19) : "No reading"} />
      </div>
      <ul>{measurement.notes.map((note) => <li key={note}>{note}</li>)}</ul>
    </UiDisclosure>
  </UiCard>;
}

function BenchmarkNetworkTrace({ traces }: { traces: NetworkExecutionTrace[] }) {
  const trace = traces.at(-1) ?? null;
  if (!trace) {
    return <div className="benchmark-network-trace empty">
      <div><Wifi size={18} /><span><small>NETWORK TRACE PER REQUEST</small><strong>No reading</strong></span></div>
      <UiText>This run provided no physical evidence for stages, transport, RTT or bytes.</UiText>
    </div>;
  }
  return <div className="benchmark-network-trace">
    <div className="benchmark-network-trace-heading">
      <div><Wifi size={18} /><span><small>LATEST NETWORK TRACE · {traces.length} SAVED</small><strong>{trace.stages.length} observed stages · {trace.physicalBoundaryCount === null ? "boundaries not read" : `${trace.physicalBoundaryCount} physical boundaries`}</strong></span></div>
      <em>{trace.durationMs} ms · attempt {trace.attempt}</em>
    </div>
    <div className="benchmark-trace-stages">
      {trace.stages.length > 0
        ? trace.stages.map((stage, index) => <span key={`${stage.routeStageIndex}-${stage.stageIndex}-${index}`}>
            <b>{stage.stageIndex + 1}</b>
            <strong>{stage.nodeId ? shortId(stage.nodeId) : "Node: No reading"}</strong>
            <small>{stage.layerStart === null || stage.layerEnd === null ? "Layers: No reading" : `layers ${stage.layerStart}–${stage.layerEnd}`} · {stage.backend} · {stage.precision}</small>
            <em>{stage.workerId ? `worker ${shortId(stage.workerId)}` : "worker: No reading"} · deployment {shortId(stage.deploymentId)} · time: No reading</em>
          </span>)
        : <UiText>Physical stages were not observed by this runtime.</UiText>}
    </div>
    <div className="benchmark-trace-boundaries">
      {trace.boundaries.length > 0
        ? trace.boundaries.map((boundary) => <span key={boundary.boundaryIndex}>
            <strong>{networkTransportLabel(boundary.transport)}</strong>
            <small>{boundary.sourceNodeId ? shortId(boundary.sourceNodeId) : "No reading"} → {boundary.destinationNodeId ? shortId(boundary.destinationNodeId) : "No reading"}</small>
            <em>RTT {formatBenchmark(boundary.connectRttMs, " ms")} · sent {formatTraceBytes(boundary.bytesSourceToDestination)} · received {formatTraceBytes(boundary.bytesDestinationToSource)} · overlap {formatBenchmark(boundary.observedOverlapMs, " ms")}</em>
          </span>)
        : <UiText>No transport boundaries between stages.</UiText>}
    </div>
  </div>;
}

function networkTransportLabel(mode: NetworkExecutionTrace["boundaries"][number]["transport"]): string {
  if (mode === "direct") return "Direct";
  if (mode === "relay") return "Relay";
  if (mode === "local") return "Local";
  return "No reading";
}

function formatTraceBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "No reading";
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function BenchmarkMetric({ icon: Icon, label, value, detail }: { icon: typeof Gauge; label: string; value: string; detail: string }) {
  return <div className="benchmark-capacity-metric"><Icon size={18} /><span><small>{label}</small><strong>{value}</strong><em>{detail}</em></span></div>;
}

function BenchmarkValue({ label, value, detail, accent = false, tone = "" }: { label: string; value: string; detail: string; accent?: boolean; tone?: string }) {
  return <div className={`benchmark-value ${accent ? "accent" : ""} ${tone}`}><small>{label}</small><strong>{value}</strong><em>{detail}</em></div>;
}

function ActivationProgressLog({ model }: { model: RequestedModelCapacity }) {
  const events = useMemo(() => activationProgressEventsForModel(model), [model]);
  const listRef = useRef<HTMLOListElement>(null);
  const currentIndex = Math.max(0, events.length - 1);
  const current = events[currentIndex] ?? events.at(-1)!;
  const nodeCount = new Set(events.flatMap((event) => event.nodeId ? [event.nodeId] : [])).size;
  const stageCount = activationStageCount(events);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [events.length, current.at, current.message]);
  return <div className="model-activation-log" aria-live="polite">
    <div className="model-activation-log-head">
      <span><Activity size={14} /> ACTIVATION TIMELINE</span>
      <small>{events.length} events{stageCount > 0 ? ` · ${stageCount} stages` : ""}{nodeCount > 0 ? ` · ${nodeCount} nodes` : ""}</small>
    </div>
    <div className={`model-activation-current ${current.state}`}>
      <span>{current.state === "running" ? "NOW" : current.state === "failed" ? "ATTENTION" : "LATEST"}</span>
      <div><strong>{activationPhaseLabel(current.phase)}</strong><small>{current.message}</small></div>
      <b>{Math.min(currentIndex + 1, events.length)} / {events.length}</b>
    </div>
    <ol ref={listRef}>{events.map((event, index) => {
      const visibleDetails = (event.details ?? []).filter(activationDetailIsReadable);
      const technicalDetails = (event.details ?? []).filter((detail) => !activationDetailIsReadable(detail));
      return <li className={`${event.state}${index === currentIndex ? " current" : ""}`} key={`${event.phase}-${event.at}-${index}`}>
        <i>{event.state === "running" ? <LoaderCircle className="spin" /> : event.state === "failed" ? <CircleAlert /> : <CheckCircle2 />}</i>
        <span>
          <strong><b>{String(index + 1).padStart(2, "0")}</b>{activationPhaseLabel(event.phase)}</strong>
          <small>{event.message}</small>
          {(event.nodeId || event.device || event.processId) && <em>
            {event.nodeId && <>NODE · {shortId(event.nodeId)}</>}
            {event.nodeId && event.device && <> &nbsp;·&nbsp; </>}
            {event.device && <>DEVICE · {event.device.toUpperCase()}</>}
            {(event.nodeId || event.device) && event.processId && <> &nbsp;·&nbsp; </>}
            {event.processId && <>PROCESS · {shortId(event.processId)}</>}
          </em>}
          {visibleDetails.length > 0 && <ul className="model-activation-facts">
            {visibleDetails.map((detail, detailIndex) => <li key={`${detail}-${detailIndex}`}>{detail}</li>)}
          </ul>}
        </span>
        <time dateTime={event.at}>{formatActivationTime(event.at)}</time>
        {technicalDetails.length > 0 && <UiDisclosure className="model-activation-details"><UiDisclosureSummary>View raw runtime details</UiDisclosureSummary><div>{technicalDetails.map((detail, detailIndex) => <code key={`${detail}-${detailIndex}`}>{detail}</code>)}</div></UiDisclosure>}
      </li>;
    })}</ol>
  </div>;
}

export function orderActivationProgressEvents<T extends { at: string }>(events: readonly T[]): T[] {
  return events
    .map((event, index) => ({ event, index, timestamp: Date.parse(event.at) }))
    .sort((left, right) => {
      const leftAt = Number.isFinite(left.timestamp) ? left.timestamp : Number.MAX_SAFE_INTEGER;
      const rightAt = Number.isFinite(right.timestamp) ? right.timestamp : Number.MAX_SAFE_INTEGER;
      return leftAt - rightAt || left.index - right.index;
    })
    .map(({ event }) => event);
}

type ActivationProgressEvent = RequestedModelCapacity["activationProgress"][number];

export function normalizeActivationProgressEvents(
  events: readonly ActivationProgressEvent[],
): ActivationProgressEvent[] {
  const ordered = orderActivationProgressEvents(events);
  const lastIndex = ordered.length - 1;
  return ordered.map((event, index) =>
    index < lastIndex && event.state === "running"
      ? { ...event, state: "completed" }
      : event
  );
}

export function activationProgressEventsForModel(
  model: Pick<
    RequestedModelCapacity,
    "activationProgress" | "activationRequestedAt" | "message" | "status" | "updatedAt"
  >,
): ActivationProgressEvent[] {
  const ordered = normalizeActivationProgressEvents(model.activationProgress ?? []);
  const latest = ordered.at(-1);
  const fallbackAt = model.activationRequestedAt ?? model.updatedAt;
  const failureAt = latest && Date.parse(fallbackAt) < Date.parse(latest.at)
    ? latest.at
    : fallbackAt;

  if (model.status === "failed" && latest?.state !== "failed") {
    return normalizeActivationProgressEvents([
      ...ordered,
      {
        phase: "failed",
        message: friendlyActivationFailure(model.message),
        at: failureAt,
        state: "failed",
        details: fallbackActivationDetails(model.message),
      },
    ]);
  }

  if (ordered.length > 0) return ordered;
  return [{
    phase: "queued",
    message: "Waiting for the coordinator to begin activation.",
    at: fallbackAt,
    state: "running",
  }];
}

function activationStageCount(events: RequestedModelCapacity["activationProgress"]): number {
  let count = 0;
  for (const event of events) {
    for (const value of [event.message, ...(event.details ?? [])]) {
      const match = /(?:stage|stages)(?:\s+ready)?(?:\s*:)?\s*(?:\d+\s*(?:of|\/)\s*)?(\d+)/i.exec(value);
      if (/stages?\s+across/i.test(value)) {
        const planned = /(\d+)\s+stages?/i.exec(value)?.[1];
        if (planned) count = Math.max(count, Number(planned));
      } else if (match?.[1]) {
        count = Math.max(count, Number(match[1]));
      }
    }
  }
  return count;
}

function activationDetailIsReadable(detail: string): boolean {
  return detail.length <= 180
    && !detail.includes("launch_process_exited:")
    && !detail.includes("managed_launch_agent_")
    && !detail.includes("distributed_activation_")
    && !detail.includes("distributed_worker_disconnected:");
}

function friendlyActivationFailure(message: string): string {
  const exhausted = /automatic_activation_retries_exhausted:(\d+):/i.exec(message);
  if (exhausted && message.includes("distributed_activation_requires_two_connected_shard_executors")) {
    return `Automatic activation paused after ${exhausted[1]} attempts because the two-PC execution route was still not verified. Keep both PCs online, then run activation again.`;
  }
  if (message.includes("distributed_activation_requires_two_connected_shard_executors")) {
    return "Two verified shard executors are not ready yet. The model remains unpublished while Mycellios rebuilds the route.";
  }
  if (exhausted) {
    return "Automatic activation stopped after repeated temporary node disconnections. The model was not published.";
  }
  if (message.includes("3221225477")) {
    return "A Windows accelerator process crashed while loading the model stage. Capacity was available, but the runtime could not complete the load.";
  }
  return message.includes("launch_process_exited:") ? "A model stage stopped during activation. Open capacity and diagnostics for the reported cause." : message.replace(/^Automatic activation failed:\s*/i, "") || "The model runtime stopped before activation completed.";
}

function fallbackActivationDetails(message: string): string[] {
  const exhaustedRetries = /automatic_activation_retries_exhausted:(\d+):/i.exec(message)?.[1];
  if (message.includes("distributed_activation_requires_two_connected_shard_executors")) {
    return exhaustedRetries
      ? [
          `Automatic retries attempted: ${exhaustedRetries}`,
          "Connected capacity is visible, but fewer than two nodes completed the required runtime and reciprocal-link evidence.",
          "Keep both PCs online, then run activation again.",
        ]
      : [
          "Connected capacity is visible, but fewer than two nodes have completed the required runtime and reciprocal-link evidence.",
          "Mycellios will retry after the verified executor topology changes.",
        ];
  }
  const details: string[] = [];
  const stage = /(?:stage-|process=)([a-z0-9-]+)/i.exec(message)?.[1];
  const code = /code=(\d+)/i.exec(message)?.[1];
  if (exhaustedRetries) details.push(`Automatic retries attempted: ${exhaustedRetries}`);
  if (stage) details.push(`Failed stage: ${stage}`);
  if (code === "3221225477") details.push("Windows exit code: 3221225477 · 0xC0000005 · native memory access violation");
  else if (code) details.push(`Process exit code: ${code}`);
  details.push("The capacity calculation passed; this failure happened during runtime startup.");
  return details;
}

function activationPhaseLabel(phase: string): string {
  return ({
    queued: "Request accepted",
    profiling: "Profiling model",
    profile_ready: "Profile complete",
    plan_ready: "Distribution calculated",
    preparing_nodes: "Preparing nodes",
    launching_stages: "Launching model stages",
    stage_loading: "Loading model stage",
    stage_ready: "Model stage ready",
    stages_ready: "Stages online",
    checking_health: "Checking pipeline",
    running_canary: "Testing real inference",
    publishing_model: "Publishing model",
    retry_wait: "Waiting to retry",
    retrying: "Retrying activation",
    active: "Activation complete",
    failed: "Activation failed",
  } as Record<string, string>)[phase] ?? phase.replaceAll("_", " ");
}

export function formatActivationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const day = date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${day}\n${time}`;
}

export function ProductStateBanner({ presentation, subject }: {
  presentation: ProductStatePresentation;
  subject: string;
}) {
  return <div className={`product-state-banner tone-${presentation.tone} state-${presentation.id}`} role="status" aria-label={`${subject}: ${presentation.label}`}>
    <i aria-hidden="true" />
    <span><small>{subject.toUpperCase()} · {presentation.label.toUpperCase()}</small><strong>{presentation.title}</strong><em>{presentation.copy}</em></span>
    <b>{presentation.nextAction}</b>
  </div>;
}


function errorText(error: unknown) { return error instanceof Error ? error.name === "TimeoutError" ? "Request timed out. Check the current status before trying again." : error.message : String(error); }
function networkNameForHubModel(source: string): string {
  return (source.split("/").at(-1) ?? source)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .slice(0, 128);
}
function formatHubCount(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatHubDate(value: string | null): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function estimatedHubMemoryMiB(model: HubCatalogModel): number | null {
  if (typeof model.estimatedMemoryMiB === "number" && Number.isFinite(model.estimatedMemoryMiB) && model.estimatedMemoryMiB > 0) {
    return model.estimatedMemoryMiB;
  }
  const name = model.id.split("/").at(-1) ?? model.id;
  const matches = [...name.matchAll(/(\d+(?:\.\d+)?)\s*b(?=$|[-_.])/gi)];
  const billions = Number(matches.at(-1)?.[1]);
  if (!Number.isFinite(billions) || billions <= 0) return null;
  const mib = 1_024 * 1_024;
  const weightBytes = billions * 1_000_000_000 * 2;
  const runtimeAndLoaderReserve = 2 * 256 * mib + Math.ceil(weightBytes * 0.1) + 2 * 64 * mib;
  return Math.ceil((weightBytes + runtimeAndLoaderReserve) / mib);
}

function friendlyModelMutationError(error: unknown): string {
  const message = errorText(error);
  if (/administrator token|admin token|invalid_model_admin_token|HTTP 401/i.test(message)) {
    return "The network administrator token is missing or invalid. Check it and try again.";
  }
  return message.replace(/^Error invoking remote method ['"]?models:[^:]+['"]?:\s*Error:\s*/i, "");
}

function WorkerKindIcon({ worker }: { worker: PublicWorker }) {
  if (worker.kind === "browser") return <Smartphone />;
  if (worker.kind === "cell") return <Boxes />;
  return <Laptop />;
}
function workerKindLabel(worker: PublicWorker) {
  if (worker.kind === "browser") return "ACTIVE BROWSER SESSION";
  if (worker.kind === "cell") return "COMPUTE CELL";
  return "INSTALLED DEVICE";
}
function workerLabel(worker: PublicWorker) {
  if (worker.kind === "browser") return `Browser ${shortId(worker.id)}`;
  if (worker.kind === "cell") {
    return worker.deployments[0]?.model
      ?? worker.gpus[0]?.model.replace(/^Aggregate capacity exposed by /, "")
      ?? `Cell ${shortId(worker.id)}`;
  }
  return worker.gpus[0]?.model || `Native node ${shortId(worker.id)}`;
}
function nodeVisualState(worker: PublicWorker): "active" | "warning" | "offline" { return !worker.quarantined && worker.connected && worker.status === "online" ? "active" : worker.quarantined || worker.connected || worker.status === "suspect" || worker.status === "draining" ? "warning" : "offline"; }
function nodeStateOrder(worker: PublicWorker): number { return nodeVisualState(worker) === "active" ? 0 : nodeVisualState(worker) === "warning" ? 1 : 2; }
function nodeStatusLabel(worker: PublicWorker): string {
  if (worker.quarantined) return "Quarantined";
  if (worker.connected && worker.status === "online") return "Active";
  if (worker.status === "suspect") return "Unstable";
  if (worker.status === "draining") return "Draining";
  if (worker.connected) return "Connected";
  return "Inactive";
}
function topologyPosition(index: number, total: number): { x: number; y: number } {
  if (total <= 1) return { x: 50, y: 17 };
  if (total <= 10) {
    const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
    return { x: 50 + Math.cos(angle) * 41, y: 52 + Math.sin(angle) * 36 };
  }
  const inner = index % 2 === 0;
  const slot = Math.floor(index / 2);
  const count = inner ? Math.ceil(total / 2) : Math.floor(total / 2);
  const angle = -Math.PI / 2 + (slot / count) * Math.PI * 2;
  return { x: 50 + Math.cos(angle) * (inner ? 28 : 43), y: 52 + Math.sin(angle) * (inner ? 25 : 38) };
}
function credentialKindLabel(kind: WorkerCredentialSummary["identityKind"]) {
  return kind === "browser"
    ? "NAVEGADOR PWA"
    : kind === "cell"
      ? "CELDA DISTRIBUIDA"
      : "DISPOSITIVO INSTALADO";
}

type ExecutionTelemetry = NonNullable<DashboardDeployment["execution"]>;
type ExecutionStageTelemetry = NonNullable<ExecutionTelemetry["stages"]>[number];

interface EffectiveExecutionSummary {
  verified: boolean;
  deviceType: "cpu" | "gpu" | "mixed" | "unknown";
  backends: ExecutionTelemetry["backend"][];
  deviceNames: string[];
  precisions: string[];
  fallback: boolean;
  fallbackReasons: string[];
  stages: ExecutionStageTelemetry[];
  unitCount: number;
}

function unknownExecutionSummary(): EffectiveExecutionSummary {
  return { verified: false, deviceType: "unknown", backends: [], deviceNames: [], precisions: [], fallback: false, fallbackReasons: [], stages: [], unitCount: 0 };
}

function summarizeDeploymentExecution(deployments: PublicDeployment[]): EffectiveExecutionSummary {
  const executions = deployments.map((deployment) => deployment.execution).filter((execution): execution is ExecutionTelemetry => execution !== undefined);
  if (executions.length === 0) return unknownExecutionSummary();
  const stages = executions.flatMap((execution) => execution.stages ?? []);
  if (stages.length > 0) return summarizeExecutionStages(stages, executions);
  const deviceTypes = new Set(executions.map((execution) => execution.deviceType));
  const hasCpu = deviceTypes.has("cpu") || deviceTypes.has("mixed");
  const hasGpu = deviceTypes.has("gpu") || deviceTypes.has("mixed");
  return {
    verified: true,
    deviceType: hasCpu && hasGpu ? "mixed" : hasGpu ? "gpu" : "cpu",
    backends: unique(executions.map((execution) => execution.backend)),
    deviceNames: unique(executions.map((execution) => execution.deviceName)),
    precisions: unique(executions.map((execution) => execution.precision)),
    fallback: executions.some((execution) => execution.fallback),
    fallbackReasons: unique(executions.flatMap((execution) => execution.fallbackReason ? [execution.fallbackReason] : [])),
    stages: [],
    unitCount: executions.length,
  };
}

function isMeasuredDeployment(
  deployment: PublicDeployment,
): deployment is PublicDeployment & { throughputSource: "measured" } {
  return deployment.throughputSource === "measured"
    && Number.isFinite(deployment.tokensPerSecond)
    && deployment.tokensPerSecond > 0;
}

function summarizeExecutionStages(stages: ExecutionStageTelemetry[], parents: ExecutionTelemetry[] = []): EffectiveExecutionSummary {
  const hasCpu = stages.some((stage) => stage.deviceType === "cpu");
  const hasGpu = stages.some((stage) => stage.deviceType === "gpu");
  return {
    verified: true,
    deviceType: hasCpu && hasGpu ? "mixed" : hasGpu ? "gpu" : "cpu",
    backends: unique(stages.map((stage) => stage.backend)),
    deviceNames: unique(stages.map((stage) => stage.deviceName)),
    precisions: unique(stages.map((stage) => stage.precision)),
    fallback: stages.some((stage) => stage.fallback) || parents.some((execution) => execution.fallback),
    fallbackReasons: unique([
      ...stages.flatMap((stage) => stage.fallbackReason ? [stage.fallbackReason] : []),
      ...parents.flatMap((execution) => execution.fallbackReason ? [execution.fallbackReason] : []),
    ]),
    stages: [...stages].sort((left, right) => left.stageIndex - right.stageIndex),
    unitCount: stages.length,
  };
}

function modelExecutionSummary(snapshot: PublicSnapshot, modelId: string): EffectiveExecutionSummary {
  return summarizeDeploymentExecution(snapshot.workers.flatMap((worker) => worker.deployments).filter((deployment) => deployment.model === modelId));
}

function workerExecutionSummary(snapshot: PublicSnapshot, worker: PublicWorker): EffectiveExecutionSummary {
  const runtimeNodeId = worker.executionNodeId ?? worker.id;
  const matchingStages = snapshot.workers
    .flatMap((candidate) => candidate.deployments)
    .flatMap((deployment) => deployment.execution?.stages ?? [])
    .filter((stage) => stage.nodeId === runtimeNodeId);
  if (matchingStages.length > 0) return summarizeExecutionStages(matchingStages);
  return summarizeDeploymentExecution(worker.deployments);
}

function unique<T>(values: T[]): T[] { return [...new Set(values)]; }

function executionShortLabel(execution: EffectiveExecutionSummary): string {
  if (!execution.verified) return "UNVERIFIED";
  if (execution.deviceType === "cpu") return execution.fallback ? "CPU FALLBACK" : "CPU ACTIVE";
  if (execution.deviceType === "gpu") return "GPU ACTIVE";
  return execution.fallback ? "MIXED · FALLBACK" : "HYBRID · AUTHORIZED";
}

function executionDetail(execution: EffectiveExecutionSummary): string {
  if (!execution.verified) return "No effective runtime telemetry";
  const units = `${execution.unitCount} ${execution.stages.length > 0 ? "stage" : "runtime"}${execution.unitCount === 1 ? "" : "s"}`;
  const backends = execution.backends.map((backend) => backend.toUpperCase()).join(" + ");
  const precision = execution.precisions.join(" + ");
  return [units, backends, precision].filter(Boolean).join(" · ");
}

function executionDeviceNames(execution: EffectiveExecutionSummary): string {
  return execution.deviceNames.length > 0 ? execution.deviceNames.join(" · ") : "Device name unavailable";
}

function ExecutionBadge({ execution, workers = [], large = false, interactive = true }: {
  execution: EffectiveExecutionSummary;
  workers?: PublicWorker[];
  large?: boolean;
  interactive?: boolean;
}) {
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const diagnosticsRef = useRef<HTMLElement>(null);
  const dialogTitleId = useId();
  const Icon = execution.deviceType === "gpu" ? Zap : execution.deviceType === "mixed" ? Network : Cpu;
  const title = execution.fallbackReasons.length > 0 ? execution.fallbackReasons.join(" · ") : executionDetail(execution);
  const diagnosticsAvailable = interactive && execution.verified && (execution.stages.length > 0 || execution.fallbackReasons.length > 0);
  const autoRepair = executionAutoRepairActive(execution, workers);
  const className = `execution-badge ${execution.deviceType}${execution.fallback ? " fallback" : ""}${large ? " large" : ""}`;
  const contents = <><Icon /><span><strong>{executionShortLabel(execution)}</strong>{large && <small>{execution.verified ? execution.backends.map((backend) => backend.toUpperCase()).join(" + ") : "NO DEVICE CLAIM"}</small>}</span>{diagnosticsAvailable && <ChevronRight className="execution-badge-arrow" />}</>;

  useEffect(() => {
    if (!diagnosticsOpen) return;
    const dialog = diagnosticsRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setDiagnosticsOpen(false); return; }
      if (dialog) trapDialogTab(event, dialog);
    };
    document.body.style.overflow = "hidden";
    if (dialog) window.requestAnimationFrame(() => firstFocusable(dialog)?.focus() ?? dialog.focus());
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      previous?.focus();
    };
  }, [diagnosticsOpen]);

  if (!diagnosticsAvailable) return <span className={className} title={title}>{contents}</span>;
  return <>
    <UiButton type="button" className={className} title={title} aria-haspopup="dialog" aria-expanded={diagnosticsOpen} onClick={() => setDiagnosticsOpen(true)}>{contents}</UiButton>
    {diagnosticsOpen && createPortal(
      <div className="execution-diagnostic-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDiagnosticsOpen(false); }}>
        <UiDialogPanel ref={diagnosticsRef} className="execution-diagnostic-dialog" role="dialog" aria-modal="true" aria-labelledby={dialogTitleId} tabIndex={-1}>
          <header className="execution-diagnostic-head">
            <div><span>REAL TELEMETRY</span><UiHeading as="h2" id={dialogTitleId}>Execution diagnostics</UiHeading><UiText>Device and backend confirmed for each process after loading the model.</UiText></div>
            <UiButton type="button" aria-label="Close diagnostics" onClick={() => setDiagnosticsOpen(false)}><X /></UiButton>
          </header>
          <div className="execution-diagnostic-summary">
            <div><small>ESTADO</small><strong>{executionShortLabel(execution)}</strong></div>
            <div><small>BACKENDS</small><strong>{execution.backends.map((backend) => backend.toUpperCase()).join(" + ")}</strong></div>
            <div><small>ETAPAS</small><strong>{execution.unitCount}</strong></div>
            <div><small>FALLBACK</small><strong>{execution.fallback ? "Yes" : "No"}</strong></div>
          </div>
          {execution.fallbackReasons.length > 0 && <div className="execution-diagnostic-alert"><CircleAlert /><span><small>MOTIVO DEL FALLBACK</small><strong>{execution.fallbackReasons.join(" · ")}</strong></span></div>}
          {autoRepair && <div className="execution-diagnostic-repair"><RefreshCw /><span><small>AUTO-REPAIR ACTIVE</small><strong>CPU keeps the service running while mycellios revalidates the GPU. When enough verified GPU capacity is available, the coordinator rebuilds the route and runs a real canary before publishing it.</strong></span></div>}
          <div className="execution-diagnostic-stages">
            <div className="execution-diagnostic-section-title"><span>MODEL ROUTE</span><small>{execution.stages.length > 0 ? `${execution.stages.length} verified stages` : "Verified runtime"}</small></div>
            {execution.stages.length > 0 ? execution.stages.map((stage) => {
              const host = executionWorkerForNode(workers, stage.nodeId);
              const stageSummary = summarizeExecutionStages([stage]);
              return <UiCard className={`execution-diagnostic-stage${stage.fallback ? " fallback" : ""}`} key={`${stage.nodeId}-${stage.stageIndex}`}>
                <div className="execution-diagnostic-stage-head"><span><b>{String(stage.stageIndex + 1).padStart(2, "0")}</b><span><small>ETAPA {stage.stageIndex + 1}</small><strong>Capas {stage.layerStart}–{stage.layerEnd}</strong></span></span><ExecutionBadge execution={stageSummary} interactive={false} /></div>
                <div className="execution-diagnostic-stage-grid">
                  <div><small>PHYSICAL DEVICE</small><strong>{host ? workerLabel(host) : "Device not identified"}</strong></div>
                  <div><small>DISPOSITIVO USADO</small><strong>{stage.deviceName}</strong></div>
                  <div><small>BACKEND</small><strong>{stage.backend.toUpperCase()} · {stage.precision}</strong></div>
                  <div><small>NODO</small><code title={stage.nodeId}>{shortId(stage.nodeId)}</code></div>
                  {host?.computeMode && <div><small>MODO</small><strong>{computeModeLabel(host.computeMode)}</strong></div>}
                </div>
                {stage.fallbackReason && <UiText><CircleAlert />{stage.fallbackReason}</UiText>}
              </UiCard>;
            }) : <UiCard className="execution-diagnostic-runtime"><strong>{executionDeviceNames(execution)}</strong><span>{executionDetail(execution)}</span></UiCard>}
          </div>
          <footer className="execution-diagnostic-foot"><HardDrive /><span><strong>Complete log on the affected machine</strong><small>Windows: <code>%APPDATA%\mycellios\mycellios.log</code>. On macOS and Linux it is stored as <code>mycellios.log</code> inside the application data folder.</small></span></footer>
        </UiDialogPanel>
      </div>,
      document.body,
    )}
  </>;
}

function ExecutionStages({ execution, workers = [], compact = false }: { execution: EffectiveExecutionSummary; workers?: PublicWorker[]; compact?: boolean }) {
  if (execution.stages.length === 0) return null;
  return <div className={`execution-stage-list${compact ? " compact" : ""}`}>
    {execution.stages.map((stage) => {
      const summary = summarizeExecutionStages([stage]);
      const host = executionWorkerForNode(workers, stage.nodeId);
      return <div className="execution-stage" key={`${stage.nodeId}-${stage.stageIndex}`}><span><small>STAGE {stage.stageIndex + 1} · LAYERS {stage.layerStart}–{stage.layerEnd}</small><strong>{stage.deviceName}</strong><em>{host ? `${workerLabel(host)} · ` : ""}{shortId(stage.nodeId)} · {stage.backend.toUpperCase()} · {stage.precision}</em></span><ExecutionBadge execution={summary} interactive={false} /></div>;
    })}
  </div>;
}

function executionWorkerForNode(workers: readonly PublicWorker[], nodeId: string): PublicWorker | undefined {
  return workers.find((worker) => (worker.executionNodeId ?? worker.id) === nodeId);
}

function executionAutoRepairActive(
  execution: EffectiveExecutionSummary,
  workers: readonly PublicWorker[],
): boolean {
  return execution.fallback && execution.stages.some((stage) => (
    executionWorkerForNode(workers, stage.nodeId)?.computeMode === "automatic"
  ));
}

function computeModeLabel(mode: NonNullable<PublicWorker["computeMode"]>): string {
  if (mode === "gpu-only") return "Solo GPU";
  if (mode === "cpu-only") return "Solo CPU";
  return "Automatic";
}

export function inferenceModelOption(snapshot: PublicSnapshot, model: PublicSnapshot["models"][number]) {
  const isNativeModel = (deployment: PublicDeployment) => deployment.model === model.id && deployment.adapter === "mycellios-pipeline";
  const peers = snapshot.workers.filter((worker) => isAvailableInferenceWorker(worker) && worker.deployments.some(isNativeModel));
  const deployments = peers.flatMap((worker) => worker.deployments).filter(isNativeModel);
  const freeSlots = deployments.reduce((total, deployment) => total + deployment.freeSlots, 0);
  const routeLabel = model.pipelines > 0
    ? `${model.pipelines} pipeline${model.pipelines === 1 ? "" : "s"}`
    : `${model.replicas} replica${model.replicas === 1 ? "" : "s"}`;
  return {
    ...model,
    nativeRuntime: deployments.length > 0 && (model.pipelines > 0 || model.replicas > 0),
    freeSlots,
    routeLabel,
    nodeCount: peers.length,
    peerMemoryMb: peers.reduce((total, worker) => total + worker.offeredVramMb, 0),
    execution: summarizeDeploymentExecution(deployments),
  };
}

function shortBuildIdentity(
  identity: NativeBuildIdentity | null | undefined,
): string {
  return shortSourceId(identity?.sourceId);
}

function shortSourceId(sourceId: string | null | undefined): string {
  return sourceId
    ? sourceId.slice("sha256:".length, "sha256:".length + 12)
    : "undeclared";
}

function buildIdentityTitle(
  identity: NativeBuildIdentity | null | undefined,
): string {
  return identity
    ? `Exact source ${identity.sourceId} · version ${identity.version}`
    : "This runtime has not published a sealed source identity.";
}

export function formatRecoveryMode(mode: "none" | "prompt-replay" | "deterministic-prefix-replay"): string {
  if (mode === "deterministic-prefix-replay") return "Exact prefix replay";
  if (mode === "prompt-replay") return "Prompt replay";
  return "No recovery";
}

async function fetchBenchmarkRuns(): Promise<BenchmarkRun[]> {
  const response = await fetch("/public/v1/benchmarks", { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  const body = await response.json() as { runs?: BenchmarkRun[]; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
  return body.runs ?? [];
}

async function requestBenchmarkRun(): Promise<BenchmarkRun> {
  const response = await fetch("/local/v1/benchmarks/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const body = await response.json() as { run?: BenchmarkRun; error?: { message?: string } };
  if (!response.ok || !body.run) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
  return body.run;
}

function benchmarkSnapshotMetric(snapshot: BenchmarkRunSnapshot, metric: BenchmarkTrendMetric): number | null {
  if (metric === "tokensPerSecond") return snapshot.tokensPerSecond;
  if (metric === "ttftMsP95") return snapshot.ttftMsP95;
  if (metric === "nodes") return snapshot.nodes;
  return snapshot.tokensPerSecondPerNode;
}

function formatSignedBenchmark(value: number | null, suffix: string): string {
  if (value === null || !Number.isFinite(value)) return "No comparison";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}${suffix}`;
}

function formatBenchmark(value: number | null, suffix: string): string {
  if (value === null || !Number.isFinite(value)) return "No reading";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}${suffix}`;
}

function formatBenchmarkRange(snapshot: BenchmarkRunSnapshot | null | undefined): string {
  if (!snapshot || snapshot.tokensPerSecondP5 === null || snapshot.tokensPerSecondP95 === null) {
    return "P5–P95 No reading";
  }
  return `P5 ${formatBenchmark(snapshot.tokensPerSecondP5, " tok/s")} · P95 ${formatBenchmark(snapshot.tokensPerSecondP95, " tok/s")}`;
}

function formatPowerReading(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "No reading" : formatPower(value);
}

function benchmarkStabilityLabel(measurement: BenchmarkMeasurement): string {
  if (measurement.workload.statisticallyStable === true) return "Stable";
  if (measurement.workload.statisticallyStable === false) return "Inconclusive";
  return "No reading";
}

function benchmarkBuildRevision(run: BenchmarkRun): string {
  const revision = run.build.revision ?? run.gitCommit;
  return revision?.trim() ? revision.trim().slice(0, 12) : "No reading";
}

function benchmarkDirtyLabel(dirty: boolean | null): string {
  if (dirty === true) return "code with local changes";
  if (dirty === false) return "clean build";
  return "build cleanliness: No reading";
}

function formatTopologyDigest(digest: string | null): string {
  if (!digest?.trim()) return "topology: No reading";
  const normalizedDigest = digest.trim().replace(/^sha256:/i, "");
  return `topology: ${normalizedDigest.slice(0, 12)}`;
}

function formatBenchmarkBackend(measurement: BenchmarkMeasurement): string {
  const backends = measurementBackends(measurement);
  return backends[0] === "__without_reading__"
    ? "Backend: No reading"
    : backends.map((backend) => backend.toUpperCase()).join(" + ");
}

function nullableBenchmarkMax(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number =>
    value !== null && value !== undefined && Number.isFinite(value)
  );
  return present.length > 0 ? Math.max(...present) : null;
}

function formatCountReading(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "No reading"
    : Math.round(value).toLocaleString("en-US");
}

function formatRate(value: number | null): string {
  return value === null || !Number.isFinite(value)
    ? "No reading"
    : `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function benchmarkCampaignStopLabel(
  reason: BenchmarkMeasurement["workload"]["campaignStopReason"],
): string {
  if (reason === "confidence_reached") return "Confidence reached";
  if (reason === "maximum_samples") return "Maximum samples";
  if (reason === "insufficient_samples") return "Insufficient samples";
  return "No reading";
}

function nullableBenchmarkSum(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number =>
    value !== null && value !== undefined && Number.isFinite(value)
  );
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : null;
}

function formatBenchmarkDate(value: string): string {
  return new Date(value).toLocaleString("en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatBenchmarkChartTime(value: string): string {
  return new Date(value).toLocaleString("en-US", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function benchmarkStatusLabel(status: BenchmarkRun["status"]): string {
  if (status === "baseline") return "Reference";
  if (status === "passed") return "Valid";
  if (status === "regression") return "Regression";
  if (status === "inconclusive") return "Inconclusive";
  return "Failed";
}

export { Panel, Tests, friendlyModelMutationError };

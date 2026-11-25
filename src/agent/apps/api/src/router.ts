import type { WebPushService } from "@mycellios/adapters";
import type {
  AgentHomeStore,
  AgentRuntime,
  AgentRunModel,
  ArtifactStore,
  JobPublisher,
  MemoryStore,
  ProductAnalytics,
  SandboxProvider,
  SecretStore,
  TransactionalEmailProvider,
} from "@mycellios/adapter-kit";
import type {
  CloudAgentConnection,
  CodexLiveCatalog,
  ComposioProvider,
  ConnectorRegistry,
  FaviconResolver,
  IntegrationProviderSettings,
  McpConnector,
  McpOAuthBroker,
  MemoryProviderResolver,
  MessagingInstallations,
  ModelsDevCatalog,
  PiOAuthLogins,
  ProviderCatalogCache,
  PushTokenStore,
  RemoteConnectorDependencies,
  TicketChangeNotifier,
  verifyModelServesAgents,
} from "@mycellios/adapters";
import type { Auth } from "@mycellios/auth";
import type { BoardEvents, PrismaClient, ThreadEvents, WebPresence } from "@mycellios/db";
import type { BillingService } from "./billing.js";
import { accountRoutes } from "./routes/account.js";
import { mycelliosApiKeyRoutes } from "./routes/mycellios-api-keys.js";
import { mycelliosApiBillingRoutes } from "./routes/mycellios-api-billing.js";
import { mycelliosIdentityRoutes } from "./routes/mycellios-identities.js";
import { referralRoutes } from "./routes/referrals.js";
import { boardsRoutes } from "./routes/boards.js";
import { botsRoutes } from "./routes/bots.js";
import { computerRoutes } from "./routes/computer.js";
import { connectionsRoutes } from "./routes/connections.js";
import { contentRoutes } from "./routes/content.js";
import { createRouterContext } from "./routes/context.js";
import { localCapabilityRoutes } from "./routes/local-capabilities.js";
import { tailscaleRoutes } from "./routes/tailscale.js";
import { mcpRoutes } from "./routes/mcp.js";
import { memoryRoutes } from "./routes/memory.js";
import { messagingRoutes } from "./routes/messaging.js";
import { whatsappRoutes } from "./routes/whatsapp.js";
import { modelsRoutes } from "./routes/models.js";
import { routinesRoutes } from "./routes/routines.js";
import { sharedMicoRoutes } from "./routes/shared-micos.js";
import { workflowsRoutes } from "./routes/workflows.js";
import { spacesRoutes } from "./routes/spaces.js";
import { developmentRoutes } from "./routes/development.js";
import { taskInboxRoutes } from "./routes/task-inbox.js";
import { hostedWebRoutes } from "./routes/hosted-webs.js";
import { threadsRoutes } from "./routes/threads.js";

export { nextConnectionLabel } from "./model-credentials.js";
export { botIntroPrompt, enqueueBotIntroRun } from "./routes/bots.js";
export { HEARTBEAT_MS, SESSION_RECHECK_MS } from "./routes/shared.js";
export { callMarkerClientNonce } from "./routes/threads.js";

export interface RouterDeps {
  androidPushConfigured?: boolean;
  androidPushProjectId?: string;
  /** True when a connected desktop host advertises agent execution for this scope. */
  desktopAgentAvailable?: (scope: { userId: string; spaceId: string }) => boolean;
  sideQuestions?: {
    runtime: AgentRuntime;
    resolveModel: (scope: { userId: string; spaceId: string; botId: string }) => Promise<AgentRunModel>;
  };

  pushTokens: PushTokenStore;
  webPush?: WebPushService;
  analytics?: ProductAnalytics;
  cloudAgent?: CloudAgentConnection | null;
  prisma: PrismaClient;
  events: ThreadEvents;
  boardEvents: BoardEvents;
  /** Optional so older test harnesses keep compiling; absent streams only heartbeats. */
  webPresence?: WebPresence;
  ticketChanges: TicketChangeNotifier;
  auth: Auth;
  jobs: JobPublisher;
  sandbox: SandboxProvider;
  memory: MemoryStore;
  memoryProviders: MemoryProviderResolver;
  home: AgentHomeStore;
  secrets: SecretStore;
  oauthLogins: PiOAuthLogins;
  /** Live Codex catalog seam; defaults to the shared per-process cache. */
  codexCatalog?: CodexLiveCatalog;
  providerCatalog?: ProviderCatalogCache;
  /** models.dev catalog seam; defaults to the shared per-process copy. */
  modelsDev?: ModelsDevCatalog;
  /** HTTP transport for model connection checks and catalog probes. */
  modelConnectionFetch?: typeof fetch;
  /** One real request proving a newly keyed model can serve agents; absent skips it. */
  modelConnectionCheck?: typeof verifyModelServesAgents;
  /** Site icons for links; defaults to the per-process cache that fetches them. */
  favicons?: FaviconResolver;
  /**
   * Detached refresh for a stored credential whose bearer expired — the live
   * catalog path calls it instead of refreshing inline. Defaults to the
   * runtime's locked `kickModelCredentialRefresh`; injectable for tests so a
   * catalog read never reaches the real OAuth refresh endpoint.
   */
  refreshExpiredModelCredential?: (
    scope: { userId: string; spaceId: string },
    secretId: string,
    provider: string,
  ) => void;
  integrationSettings?: IntegrationProviderSettings;
  composio?: ComposioProvider;
  mcpOAuth?: McpOAuthBroker;
  tailnets?: import("@mycellios/adapters").TailnetService;
  /**
   * The API process's MCP connector, used to launch/list an MCP server once so its health
   * is visible (`mcp.servers.test` and the probe after create/update/OAuth). Without it
   * servers are simply never probed from here.
   */
  mcp?: Pick<McpConnector, "probe">;
  connectors: ConnectorRegistry;
  remoteConnectors?: RemoteConnectorDependencies;
  artifacts: ArtifactStore;
  dataDir: string;
  /** Present when the external messaging surface is enabled. */
  messagingInstallations?: MessagingInstallations;
  messaging?: {
    enabled: boolean;
    providers: string[];
    addresses: Record<string, string>;
    openSignup: boolean;
  };
  /** Present only when the deployment bills; self-hosted installs leave it unset. */
  billing?: BillingService;
  /** The deployment's transactional mail, when configured; Space invitations use it. */
  email?: TransactionalEmailProvider;
  env: {
    /** People invited to Spaces; absent while the deployment keeps it off (specs/space-members). */
    spaceMembers?: { limit: number };
    mycelliosSso?: boolean;
    /** The Mycellios identity authority (the OIDC issuer) when Mycellios SSO is on. */
    mycelliosIdentityIssuer?: string;
    defaultModelMaxTokens?: number;
    defaultModelContextWindow?: number;
    ticketBoardEnabled?: boolean;
    phoneCallsEnabled?: boolean;
    phoneCallRingSeconds?: number;
    maxUploadSizeBytes?: number;
    agentRuntime: string;
    teamChatJudgeProvider?: string;
    teamChatJudgeModel?: string;
    defaultProvider: string;
    defaultModel: string;
    deploymentModelConfigured?: boolean;
    deploymentModelHostCredentials?: boolean;
    webOrigin: string;
    privacyPolicyUrl?: string;
    screenProxySecret: string;
    sandboxProvider: string;
    gitSha?: string;
    integrationsCatalogUrl?: string;
    mcpAllowPrivateEndpoint?: boolean;
    desktopHostChoiceEnabled?: boolean;
    /** Whether MCP stdio servers can run, and the commands they may launch. */
    mcpStdioEnabled?: boolean;
    mcpStdioAllowedCommands?: string[];
  };
}

export function createRouter(deps: RouterDeps) {
  const ctx = createRouterContext(deps);
  const { os } = ctx;

  return os.router({
    ...hostedWebRoutes(ctx),
    ...localCapabilityRoutes(ctx),
    ...accountRoutes(ctx),
    ...mycelliosApiKeyRoutes(ctx),
    ...mycelliosApiBillingRoutes(ctx),
    ...mycelliosIdentityRoutes(ctx),
    ...referralRoutes(ctx),
    ...spacesRoutes(ctx),
    ...sharedMicoRoutes(ctx),
    ...modelsRoutes(ctx),
    ...botsRoutes(ctx),
    ...developmentRoutes(ctx),
    ...threadsRoutes(ctx),
    ...taskInboxRoutes(ctx),
    ...computerRoutes(ctx),
    ...memoryRoutes(ctx),
    ...routinesRoutes(ctx),
    ...workflowsRoutes(ctx),
    ...boardsRoutes(ctx),
    ...mcpRoutes(ctx),
    ...tailscaleRoutes(ctx),
    ...connectionsRoutes(ctx),
    ...messagingRoutes(ctx),
    ...whatsappRoutes(ctx),
    ...contentRoutes(ctx),
  });
}

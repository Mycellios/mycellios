import {
  HostedWebAgent,
  HostedWebCard,
  HostedWebDataEntry,
  HostedWebDataGet,
  HostedWebDataList,
  HostedWebDataSet,
  HostedWebDataUsage,
  HostedWebDraft,
  HostedWebFileEntry,
  HostedWebFilePut,
  HostedWebFileRef,
  HostedWebFilesStatus,
  HostedWebFilesUsage,
  HostedWebSave,
  HostedWebSnapshot,
  HostedWebPresence,
  HostedWebTeam,
} from "./hosted-webs.js";
import { MicoSettingsState, MicoSettingsUpdate } from "./mico-settings.js";
import { TailnetConnectionInput, TailnetConnectionSchema, TailnetSuffix } from "./tailscale.js";
import { ReferralOwnerInput, ReferralInviteSchema, ReferralRedemptionSchema } from "./referrals.js";
import { AppCoverId, AppCoverWrite } from "./app-covers.js";
import { NotificationSettingsSchema, WebPushSubscriptionSchema } from "./notification-settings.js";
import { eventIterator, oc } from "@orpc/contract";
import { WhatsAppLinkSchema, WhatsAppSenderAddInput, WhatsAppSenderSchema } from "./whatsapp-link.js";
import * as z from "zod";
import { AccountPlanLimitSchema, AccountPlanLimitsSchema } from "./plan-limits.js";
import { InboxTaskSchema, TaskInboxSendSchema } from "./task-inbox.js";
import {
  BranchConversationInputSchema,
  BranchConversationOutputSchema,
  SideThreadRequestSchema,
  SideThreadSchema,
  SideThreadTargetSchema,
} from "./side-threads.js";
import { CancelOpenWaitResultSchema, OpenWaitSchema } from "./event-waits.js";
import {
  AwaitingRepliesSchema,
  HideAwaitingRepliesInputSchema,
  StopAwaitingReplyInputSchema,
} from "./awaiting-replies.js";
import {
  MESSAGE_QUEUE_EDIT_MAX_LENGTH,
  MESSAGE_QUEUE_REORDER_LIMIT,
  MessageQueueStateSchema,
  QueueHoldIdSchema,
} from "./message-queue.js";
import { RoutineCalendarInputSchema, RoutineCalendarSchema } from "./routine-calendar.js";
import { UsageDashboardInputSchema, UsageDashboardSchema } from "./usage-dashboard.js";
import { SporeRewardsSchema } from "./spore-rewards.js";
import { ProjectId, ProjectName, ProjectSummary } from "./projects.js";
import { WorkflowSchema, WorkflowGraphSchema, WorkflowExecutionSchema } from "./workflows.js";
import { ContributionEnrollmentSchema, ContributionNodeInput, ContributionStateSchema } from "./contribution.js";
import {
  AgentImportCreateInput,
  AgentImportInfoSchema,
  AgentImportPlanSchema,
  AgentImportPreviewInput,
  AgentImportUndoInput,
} from "./agent-import.js";
import { AgentImportSetupStateInput, AgentImportSetupStateSchema } from "./agent-import-setup.js";
import { AiConsentQuerySchema, AiConsentStatusSchema } from "./ai-consent.js";
import { AnalyticsScreenInput } from "./analytics.js";
import {
  ARTIFACT_DESCRIPTION_MAX_LENGTH,
  ARTIFACT_NAME_MAX_LENGTH,
  ATTACHMENT_MAX_COUNT,
} from "./attachments.js";
import {
  BoardEventSchema,
  BoardSchema,
  CommentTicketInput,
  CreateTicketInput,
  GetTicketInput,
  ListTicketsInput,
  ListTicketsOutput,
  MoveTicketInput,
  RenameBoardInput,
  TicketCommentSchema,
  TicketSchema,
  UpdateTicketInput,
} from "./board.js";
import { BotSecretMetadata, BotSecretPutInput, StoredBotSecretName } from "./bot-secrets.js";
import {
  ActionApprovalRuleSchema,
  ActionAutoReviewSettingsSchema,
  AgentSecretInputSchema,
  AgentSecretSchema,
  AgentSkillCatalogEntrySchema,
  AgentSkillSchema,
  AppBootstrapSchema,
  ApprovalModeSchema,
  ArtifactSchema,
  ArtifactShareSchema,
  ArtifactVersionSchema,
  ArtifactWithContentSchema,
  AvatarStyleSchema,
  BillingStatusSchema,
  BotMcpServerSchema,
  BotSchema,
  BotSectionName,
  BotSectionSchema,
  CapabilityInstallSchema,
  CONNECTION_LABEL_MAX_LENGTH,
  ComputerModeSchema,
  ComputerReleaseReasonSchema,
  ComputerStatusSchema,
  ComputerUpdateSchema,
  ConnectionCatalogItemSchema,
  ConnectionSchema,
  CreateAgentSkillInput,
  CreateBotInput,
  CreateGroupInput,
  CreateRoutineInput,
  CreateScratchpadItemInput,
  DeploymentSettingsSchema,
  ExportManifestSchema,
  ExternalConversationPolicySchema,
  GroupDetailSchema,
  GroupSchema,
  IntegrationCatalogResultSchema,
  McpServerConfigInput,
  McpServerSchema,
  MemoryDocumentSchema,
  MemoryScopeSchema,
  MeSchema,
  MessagingAgentConnectionSchema,
  MessagingChannelMembershipSchema,
  MessagingInstallationsStatusSchema,
  MessagingLinkedIdentitySchema,
  MessagingStatusSchema,
  ModelBackupChoiceSchema,
  ModelBackupListSchema,
  ModelCatalogEntrySchema,
  ModelConnectInputSchema,
  ModelConnectionLabelSchema,
  ModelConnectionTargetSchema,
  ModelCredentialSchema,
  ModelCreditAmountSchema,
  ModelOAuthBeginSchema,
  OPENAI_COMPATIBLE_PROVIDER_ID,
  REPLY_QUOTE_MAX_LENGTH,
  ReorderBotsInput,
  RoutineRunInChoiceSchema,
  RoutineSchema,
  ScratchpadItemSchema,
  ScratchpadItemStatusSchema,
  ServerUpdateCheckSchema,
  ServerUpdateRequestSchema,
  ServerUpdateRunSchema,
  ServerUpdateStatusSchema,
  SignupSurveySchema,
  SkillPlaybookSchema,
  SpaceMemoryConfigSchema,
  SpaceNavigationSchema,
  SpaceSchema,
  TaughtSkillSchema,
  TeachRecordingEventSchema,
  ThinkingLevelSchema,
  ThreadMessagePageSchema,
  ThreadSnapshotSchema,
  TimeZoneSchema,
  UpdateAgentSkillInput,
  UpdateBotInput,
  UpdateExternalConversationPolicyInput,
  UpdateGroupInput,
  AddGroupFolderInput,
  GroupFolderSchema,
  RemoveGroupFolderInput,
  UsageRecordSchema,
  UsageSummarySchema,
  VoiceCatalogEntrySchema,
  VoiceCredentialSchema,
  VoiceInfoSchema,
  VoiceStatusSchema,
} from "./domain.js";
import {
  MemoryConnectionCreateInput,
  MemoryConnectionSchema,
  MemoryGrantsSetInput,
  MicoMemoryGrantSchema,
} from "./memory-mcp.js";
import { ComputerCommandSchema, ProductEventSchema } from "./events.js";
import { Id, IsoDate } from "./ids.js";
import {
  IntegrationProviderConfigSchema,
  IntegrationSetupStateSchema,
} from "./integration-settings.js";
import { ModelHeadersSchema } from "./model-headers.js";
import { ModelRoleSchema, ModelRoleUpdateSchema, ModelRoleViewSchema } from "./model-roles.js";
import { MycelliosAccountSchema } from "./mycellios-account.js";
import {
  MycelliosApiKeyCreatedSchema,
  MycelliosApiKeyCreateInput,
  MycelliosApiKeyListInput,
  MycelliosApiKeyListSchema,
  MycelliosApiKeyRevokeInput,
} from "./mycellios-api-keys.js";
import {
  MycelliosApiCheckoutInput,
  MycelliosApiPlanSchema,
  MycelliosApiPortalInput,
  MycelliosApiReadInput,
  MycelliosApiRedirectSchema,
  MycelliosApiUsageSchema,
} from "./mycellios-api-billing.js";
import {
  MycelliosIdentityLinkInput,
  MycelliosIdentityLinkSchema,
  MycelliosIdentityListInput,
  MycelliosIdentityUnlinkInput,
  MycelliosSignInMethodsSchema,
} from "./mycellios-identities.js";
import { MessageReactionSchema } from "./reactions.js";
import { RoutineWatchSchema } from "./routine-watch.js";
import { RunLogsInputSchema, RunLogsOutputSchema } from "./run-logs.js";
import { RoutineHistorySchema, RoutineRunCursorSchema, RunsListOutputSchema } from "./runs.js";
import { SearchFilterSchema, SearchQueryOutputSchema, ThreadSearchOutputSchema } from "./search.js";
import { MessagePinSchema, MICO_PINS_LIST_LIMIT, MicoMessagePinSchema } from "./message-pins.js";
import { SecurityEventListInputSchema, SecurityEventSchema } from "./security-events.js";
import { SettingsScopeSchema, SpaceSettingSchema, settingsScopeInput } from "./settings-scope.js";
import { AgentUsageReportSchema, LastModelCallSchema, TaskCostSchema } from "./task-cost.js";

const botId = z.object({ botId: Id });
const groupId = z.object({ groupId: Id });

const threadTarget = z
  .object({
    botId: Id.optional(),
    groupId: Id.optional(),
    taskThreadId: Id.optional(),
  })
  .superRefine((input, ctx) => {
    const hasBot = Boolean(input.botId);
    const hasGroup = Boolean(input.groupId);
    if (input.taskThreadId && !hasBot) ctx.addIssue({code:"custom",message:"Task conversations require a Mico",path:["taskThreadId"]});
    if (hasBot === hasGroup) {
      ctx.addIssue({
        code: "custom",
        message: "Provide exactly one of botId or groupId",
        path: ["botId"],
      });
    }
  });

const structuredMentionTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bot"), id: Id }),
  z.object({ kind: z.literal("group"), id: Id }),
  z.object({ kind: z.literal("routine"), id: Id }),
  z.object({ kind: z.literal("connector"), id: Id }),
  /** One of the same Mico's conversations; the message links to it. */
  z.object({ kind: z.literal("thread"), id: Id }),
]);

const queuedMessageTarget = threadTarget.safeExtend({ messageId: Id });

const threadSendInput = threadTarget
  .safeExtend({
    text: z.string().optional(),
    taskInstructions: z.string().max(16000).optional(),
    delivery: z.enum(["queue", "steer"]).optional(),
    artifactIds: z.array(Id).max(ATTACHMENT_MAX_COUNT).optional(),
    /** Bare bot ids (legacy) or typed mention chips from the composer. */
    mentions: z
      .array(z.union([Id, structuredMentionTarget]))
      .max(64)
      .optional(),
    replyToMessageId: Id.optional(),
    replyQuote: z.string().trim().min(1).max(REPLY_QUOTE_MAX_LENGTH).optional(),
    clientNonce: z.string().min(1).max(200).optional(),
  })
  .superRefine((input, ctx) => {
    const text = input.text?.trim() ?? "";
    const artifactIds = input.artifactIds ?? [];
    if (!text && artifactIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Provide text or at least one attachment",
        path: ["text"],
      });
    }
    if (input.replyQuote && !input.replyToMessageId) {
      ctx.addIssue({
        code: "custom",
        message: "replyQuote requires replyToMessageId",
        path: ["replyQuote"],
      });
    }
  });

const spaceName = z.string().trim().min(1).max(60);

export const appContract = {
  mycelliosApiKeys: {
    list: oc.input(MycelliosApiKeyListInput).output(MycelliosApiKeyListSchema),
    create: oc.input(MycelliosApiKeyCreateInput).output(MycelliosApiKeyCreatedSchema),
    revoke: oc.input(MycelliosApiKeyRevokeInput).output(z.object({ revoked: z.literal(true) })),
  },
  mycelliosApiBilling: {
    plan: oc.input(MycelliosApiReadInput).output(MycelliosApiPlanSchema),
    usage: oc.input(MycelliosApiReadInput).output(MycelliosApiUsageSchema),
    checkout: oc.input(MycelliosApiCheckoutInput).output(MycelliosApiRedirectSchema),
    portal: oc.input(MycelliosApiPortalInput).output(MycelliosApiRedirectSchema),
  },
  mycelliosIdentities: {
    list: oc.input(MycelliosIdentityListInput).output(MycelliosSignInMethodsSchema),
    link: oc.input(MycelliosIdentityLinkInput).output(MycelliosIdentityLinkSchema),
    unlink: oc.input(MycelliosIdentityUnlinkInput).output(z.object({ unlinked: z.literal(true) })),
  },
  referrals: {
    invite: oc.input(ReferralOwnerInput).output(ReferralInviteSchema),
    redeem: oc.input(ReferralOwnerInput).output(ReferralRedemptionSchema),
  },
  webs: {
    agent: oc.input(z.object({ id: z.string() })).output(HostedWebAgent.nullable()),
    assignAgent: oc.input(z.object({ id: z.string(), botId: z.string().nullable() })).output(HostedWebAgent.nullable()),
    revision: oc.input(z.object({ id: z.string() })).output(z.number().int().positive()),
    team: oc.input(z.object({ id: z.string() })).output(HostedWebTeam),
    presence: oc.input(z.object({ id: z.string() })).output(eventIterator(HostedWebPresence)),
    list: oc.input(z.object({ filter: z.enum(["discover", "trending", "pinned", "mine"]), query: z.string().max(100).default("") })).output(z.array(HostedWebCard)),
    draft: oc.input(z.object({ id: z.string() })).output(HostedWebDraft),
    save: oc.input(HostedWebSave).output(HostedWebDraft),
    publish: oc.input(z.object({ id: z.string(), version: z.number().int().positive() })).output(HostedWebCard),
    unpublish: oc.input(z.object({ id: z.string() })).output(z.object({ ok: z.literal(true) })),
    pin: oc.input(z.object({ id: z.string(), pinned: z.boolean() })).output(z.object({ ok: z.literal(true) })),
    clone: oc.input(z.object({ id: z.string(), newId: z.string().uuid() })).output(HostedWebDraft),
    antseed: oc.input(z.object({ id: z.string().uuid() })).output(HostedWebDraft),
    preview: oc.input(z.object({ id: z.string(), version: z.number().int().positive() })).output(z.object({ path: z.string(), expiresAt: z.string() })),
    history: {
      list: oc.input(z.object({ id: z.string().uuid() })).output(z.array(HostedWebSnapshot)),
      restore: oc
        .input(z.object({ id: z.string().uuid(), snapshotId: z.string().uuid(), version: z.number().int().positive() }).strict())
        .output(HostedWebDraft),
    },
    files: {
      status: oc.output(HostedWebFilesStatus),
      put: oc.input(HostedWebFilePut).output(HostedWebFilesUsage),
      get: oc.input(HostedWebFileRef).output(z.object({ mimeType: z.string(), contentBase64: z.string() })),
      delete: oc.input(HostedWebFileRef).output(HostedWebFilesUsage),
      list: oc
        .input(z.object({ id: z.string().uuid(), preview: z.boolean() }).strict())
        .output(z.object({ entries: z.array(HostedWebFileEntry), usage: HostedWebFilesUsage })),
    },
    data: {
      get: oc.input(HostedWebDataGet).output(z.object({ found: z.boolean(), value: z.json().nullable() })),
      set: oc.input(HostedWebDataSet).output(HostedWebDataUsage),
      delete: oc.input(HostedWebDataGet).output(HostedWebDataUsage),
      list: oc.input(HostedWebDataList).output(z.object({ entries: z.array(HostedWebDataEntry), usage: HostedWebDataUsage })),
    },
  },
  analytics: { screen: oc.input(AnalyticsScreenInput.extend({ installationId: z.string().uuid().optional(), linkAccount: z.boolean().optional() }).strict()).output(z.object({ ok: z.literal(true) })) },
  aiConsent: {
    status: oc.input(AiConsentQuerySchema).output(AiConsentStatusSchema),
    allow: oc
      .input(
        z.object({
          scope: z.string(),
          version: z.string(),
          keys: z.array(z.string()).min(1).max(200),
          /** The settings copy the reviewed recipients came from, as in `status`. */
          settingsScope: SettingsScopeSchema.optional(),
        }),
      )
      .output(AiConsentStatusSchema),
    revoke: oc.input(z.object({ key: z.string().nullable() })).output(AiConsentStatusSchema),
  },
  health: oc.output(z.object({ ok: z.literal(true), version: z.string() })),
  me: oc.output(MeSchema),
  billing: {
    status: oc.output(BillingStatusSchema),
    selectFunding: oc
      .input(z.object({ funding: z.enum(["byok", "credits"]) }))
      .output(z.object({ ok: z.literal(true) })),
    purchaseCredits: oc
      .input(z.object({ amountCents: ModelCreditAmountSchema, monthly: z.boolean() }))
      .output(z.object({ url: z.string().url() })),
    setMonthlyCredits: oc
      .input(z.object({ amountCents: ModelCreditAmountSchema }))
      .output(z.object({ ok: z.literal(true) })),
    checkout: oc.output(z.object({ url: z.string().url() })),
    portal: oc.output(z.object({ url: z.string().url() })),
  },
  preferences: {
    micos: oc.output(MicoSettingsState),
    updateMicos: oc.input(MicoSettingsUpdate).output(MicoSettingsState),
    applyBusyMode: oc.input(z.object({ mode: z.enum(["queue", "steer"]).nullable() })).output(z.object({ ok: z.literal(true) })),
    update: oc
      .input(
        z
          .object({
            avatarStyle: AvatarStyleSchema.optional(),
            timezone: TimeZoneSchema.nullable().optional(),
          })
          .refine((input) => input.avatarStyle !== undefined || input.timezone !== undefined, {
            message: "Nothing to update",
          }),
      )
      .output(MeSchema),
    /** Saves a detected timezone only while none is saved, so it never replaces a choice. */
    adoptTimezone: oc.input(z.object({ timezone: TimeZoneSchema })).output(MeSchema),
  },
  spaces: {
    list: oc.output(SpaceNavigationSchema),
    create: oc.input(z.object({ name: spaceName })).output(SpaceSchema),
    rename: oc
      .input(z.object({ spaceId: Id, name: spaceName }))
      .output(z.object({ id: Id, name: z.string() })),
    remove: oc
      .input(z.object({ spaceId: Id }))
      .output(z.object({ ok: z.literal(true), activeSpaceId: Id })),
  },
  bootstrap: oc.input(z.object({
    botId: Id.optional(), taskThreadId: Id.optional(), history: z.literal("recent").optional(),
  })
    .refine(input => !input.taskThreadId || Boolean(input.botId), "A task conversation requires its Mico"))
    .output(AppBootstrapSchema),
  deployment: {
    get: oc.output(DeploymentSettingsSchema),
    update: oc
      .input(
        z.object({
          signupsEnabled: z.boolean().optional(),
          signupAllowlist: z.array(z.string()).optional(),
          computerHost: z.enum(["docker", "this-mac"]).nullable().optional(),
        }),
      )
      .output(DeploymentSettingsSchema),
  },
  /** Deployment-owner view of the append-only security event log, newest first. */
  security: {
    events: oc.input(SecurityEventListInputSchema).output(z.array(SecurityEventSchema)),
  },
  /**
   * Deployment-owner product updates. When the Compose updater sidecar is reachable, these proxy
   * to its `/state` `/plan` `/apply` contract. Rollback stays on the sidecar for ops only and is
   * not exposed here. Never git-fetch from the API process.
   */
  updater: {
    status: oc.output(ServerUpdateStatusSchema),
    check: oc.input(ServerUpdateRequestSchema).output(ServerUpdateCheckSchema),
    apply: oc.input(ServerUpdateRequestSchema).output(ServerUpdateRunSchema),
  },
  engines: {
    forBot: oc.input(z.object({ botId: Id })).output(z.object({
      computer: z.enum(["desktop", "server"]),
      engines: z.array(z.enum(["codex", "claude", "opencode"])),
      /** Installed engines whose CLI reported nobody signed in. Older servers omit it. */
      signedOut: z.array(z.enum(["codex", "claude", "opencode"])).optional(),
    })),
    codexQuota: oc.output(AccountPlanLimitSchema.nullable()),
    codexModels: oc.output(z.array(z.object({ id: z.string(), label: z.string(), isDefault: z.boolean(), thinkingLevels: z.array(z.string()), defaultThinkingLevel: z.string().optional(), fast: z.boolean() }))),
    list: oc.output(
      z.array(
        z.object({
          id: z.enum(["pi", "codex", "claude", "acp", "opencode"]),
          name: z.string(),
          available: z.boolean(),
          /** Absent when the CLI could not say (older host, timeout or unsupported engine). */
          signedIn: z.boolean().optional(),
          managedVersion: z.string().optional(),
          canInstall: z.boolean().optional(),
        }),
      ),
    ),
    installOpenCode: oc.output(z.object({ installed: z.literal(true) })),
    registry: oc.output(z.array(z.object({
      id: z.string(), name: z.string(), version: z.string(), description: z.string().optional(),
    }))),
  },
  models: {
    planLimits: oc.input(z.object({ refresh: z.boolean().optional() }).optional()).output(AccountPlanLimitsSchema),
    contributionStatus: oc.input(ContributionNodeInput).output(ContributionStateSchema),
    contributionControl: oc.input(ContributionNodeInput.extend({ action: z.enum(["pause", "resume"]) })).output(ContributionStateSchema),
    contributionEnrollment: oc.output(ContributionEnrollmentSchema),
    browserContributionLink: oc.input(z.object({ workerId: z.string().uuid(), token: z.string().min(32).max(256),
      expectedUserId: z.string().min(1).max(128) }).strict()).output(z.object({ linked: z.boolean() })),
    discoverLocal: oc.output(
      z.array(z.object({ name: z.string(), baseUrl: z.string(), modelIds: z.array(z.string()) })),
    ),
    mycelliosAccount: oc.input(z.object({ refresh: z.boolean().optional() }).optional()).output(MycelliosAccountSchema.nullable()),
    connectMycellios: oc.output(ModelCredentialSchema),
    mycelliosModels: oc.output(z.array(ModelCatalogEntrySchema)),
    mycelliosVideoEdit:oc.input(z.object({action:z.enum(["info","quote","execute","status","content"]),payload:z.string().max(34_000_000)})).output(z.unknown()),
    mycelliosMedia: oc.input(z.object({ action:z.enum(["models","quote","execute","status","content","checkout"]),expectedUserId:z.string().min(1).max(128).optional(),
      payload:z.string().max(12_000_000).optional(),key:z.string().min(8).max(200).optional() })).output(z.unknown()),

    forRole: oc
      .input(z.object({ role: ModelRoleSchema, expectedUserId: Id.optional() }))
      .output(z.array(ModelCatalogEntrySchema)),
    role: oc
      .input(
        z.object({
          role: ModelRoleSchema,
          expectedUserId: Id.optional(),
          scope: SettingsScopeSchema.optional(),
        }),
      )
      .output(ModelRoleViewSchema),
    setRole: oc
      .input(
        ModelRoleUpdateSchema.extend({
          role: ModelRoleSchema,
          expectedUserId: Id.optional(),
          scope: SettingsScopeSchema.optional(),
        }),
      )
      .output(ModelRoleViewSchema),
    list: oc.output(z.array(ModelCatalogEntrySchema)),
    credentials: oc.output(z.array(ModelCredentialSchema)),
    backups: oc.output(z.array(ModelBackupChoiceSchema)),
    setBackups: oc.input(ModelBackupListSchema).output(z.object({ ok: z.literal(true) })),
    connect: oc.input(ModelConnectInputSchema).output(ModelCredentialSchema),
    probeOpenAiCompatible: oc
      .input(
        z.object({
          provider: z.enum(["openai-compatible", "antseed"]).optional(),
          baseUrl: z.string(),
          credentialId: z.string().optional(),
          headers: ModelHeadersSchema.optional(),
          apiKey: z.string().optional(),
        }),
      )
      .output(z.object({ models: z.array(z.string()) })),
    probeCatalog: oc
      .input(
        z.object({
          provider: z.string().trim().min(1),
          apiKey: z.string().trim().min(8),
        }),
      )
      .output(z.object({ models: z.array(z.string()) })),
    beginOAuth: oc
      .input(
        z.object({
          provider: z.string(),
          label: z.string().optional(),
          /** Signs an existing connection in again; null adds another, as connect does. */
          credentialId: ModelConnectionTargetSchema,
          modelId: z.string().optional(),
          thinkingLevel: ThinkingLevelSchema.nullable().optional(),
          makeDefault: z.boolean().optional(),
          scope: SettingsScopeSchema.optional(),
          /** No loopback listener (web, mobile): the provider shows a code to paste instead. */
          codePage: z.boolean().optional(),
        }),
      )
      .output(ModelOAuthBeginSchema),
    submitOAuthCode: oc
      .input(z.object({ loginId: z.string(), code: z.string().trim().min(1).max(8_192) }))
      .output(z.object({ ok: z.literal(true) })),
    completeOAuth: oc
      .input(z.object({ loginId: z.string() }))
      .output(
        z.discriminatedUnion("status", [
          z.object({ status: z.literal("pending") }),
          z.object({ status: z.literal("ready") }),
          z.object({ status: z.literal("error"), error: z.string() }),
        ]),
      ),
    finishOAuth: oc.input(z.object({ loginId: z.string() })).output(ModelCredentialSchema),
    cancelOAuth: oc
      .input(z.object({ loginId: z.string() }))
      .output(z.object({ ok: z.literal(true) })),
    setDefault: oc
      .input(
        z.object({
          provider: z.string(),
          modelId: z.string(),
          thinkingLevel: ThinkingLevelSchema.nullable().optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    rename: oc
      .input(z.object({ credentialId: Id, label: ModelConnectionLabelSchema }))
      .output(z.object({ ok: z.literal(true) })),
    /** Removes one connection, or every connection of the provider when older apps omit it. */
    disconnect: oc
      .input(z.object({ provider: z.string().trim().min(1), credentialId: Id.optional() }))
      .output(z.object({ ok: z.literal(true) })),
  },
  bots: {
    list: oc.output(z.array(BotSchema)),
    listArchived: oc.output(z.array(BotSchema)),
    get: oc.input(botId).output(BotSchema),
    create: oc.input(CreateBotInput).output(BotSchema),
    /** Profile setup never queues a model turn; an old server fails before creation. */
    createProfile: oc.input(CreateBotInput.extend({ expectedUserId: z.string().min(1).max(256) })).output(BotSchema),
    /** Opening a Mico's untouched chat queues its one welcome turn; later calls do nothing. */
    welcome: oc.input(botId).output(z.object({ queued: z.boolean() })),
    importPreview: oc.input(AgentImportPreviewInput).output(AgentImportPlanSchema),
    importCreate: oc.input(AgentImportCreateInput).output(BotSchema),
    importInfo: oc.input(botId).output(AgentImportInfoSchema.nullable()),
    importSetupState: oc.input(AgentImportSetupStateInput).output(AgentImportSetupStateSchema),
    importUndo: oc.input(AgentImportUndoInput).output(AgentImportInfoSchema),
    duplicate: oc.input(botId).output(BotSchema),
    reorder: oc.input(ReorderBotsInput).output(z.object({ ok: z.literal(true) })),
    update: oc.input(UpdateBotInput).output(BotSchema),
    restoreInstructions: oc
      .input(
        z.object({
          botId: Id,
          versionId: Id,
          expectedInstructions: z.string(),
          undo: z.boolean().optional(),
        }),
      )
      .output(BotSchema),
    setComputer: oc.input(z.object({ botId: Id, mode: ComputerModeSchema })).output(BotSchema),
    /** Close the Mico's browser and delete its profile; the next run starts signed out. */
    resetBrowser: oc.input(botId).output(z.object({ ok: z.literal(true), computerOff: z.boolean() })),
    archive: oc.input(botId).output(z.object({ ok: z.literal(true) })),
    restore: oc.input(botId).output(z.object({ ok: z.literal(true) })),
    remove: oc
      .input(z.object({ botId: Id, deleteMemories: z.boolean().default(false) }))
      .output(z.object({ ok: z.literal(true) })),
    rotateWebhookSecret: oc.input(botId).output(
      z.object({
        secret: z.string(),
        path: z.string(),
        webhookConfigured: z.literal(true),
      }),
    ),
  },
  groups: {
    create: oc.input(CreateGroupInput).output(GroupSchema),
    list: oc.output(z.array(GroupSchema)),
    listArchived: oc.output(z.array(GroupSchema)),
    get: oc.input(groupId).output(GroupDetailSchema),
    duplicate: oc.input(groupId).output(GroupSchema),
    update: oc.input(UpdateGroupInput).output(GroupSchema),
    archive: oc.input(groupId).output(z.object({ ok: z.literal(true) })),
    restore: oc.input(groupId).output(z.object({ ok: z.literal(true) })),
    remove: oc.input(groupId).output(z.object({ ok: z.literal(true) })),
    /** Shared folders (specs/group-shared-folders/spec.md): ids and names, never paths. */
    folders: oc.input(groupId).output(z.object({ spaceId: Id, folders: z.array(GroupFolderSchema) })),
    addFolder: oc.input(AddGroupFolderInput).output(GroupFolderSchema),
    removeFolder: oc.input(RemoveGroupFolderInput).output(z.object({ ok: z.literal(true) })),
  },
  botSections: {
    list: oc.output(z.array(BotSectionSchema)),
    create: oc.input(z.object({ botId: Id.optional(), groupId: Id.optional(), name: BotSectionName, parentId: Id.nullable().optional() })
      .refine(input => !(input.botId && input.groupId), "Choose one chat")).output(BotSectionSchema),
    update: oc.input(z.object({ sectionId: Id, name: BotSectionName.optional(), parentId: Id.nullable().optional() })
      .refine(input => input.name !== undefined || input.parentId !== undefined, "Choose a folder change")).output(BotSectionSchema),
    remove: oc.input(z.object({ sectionId: Id })).output(
      z.object({
        id: Id,
        releasedBots: z.number().int().nonnegative(),
        releasedGroups: z.number().int().nonnegative(),
      }),
    ),
  },
  development: {
    projects: oc.input(z.object({})).output(z.array(ProjectSummary)),
    primaryRun: oc.input(z.object({ botId: Id, runId: Id })).output(z.boolean()),
    saveProject: oc.input(z.object({ id: ProjectId, name: ProjectName })).output(z.object({ id: ProjectId })),
    projectTask: oc.input(z.object({ botId: Id, taskThreadId: Id })).output(z.object({ projectId: ProjectId, name: ProjectName, userId: Id, spaceId: Id }).nullable()),
    status: oc.input(z.object({botId:Id,taskThreadId:Id,runId:Id})).output(z.object({status:z.string(),detail:z.string().max(128000),error:z.string().nullable()})),
    open: oc.input(z.object({botId:Id,projectKey:z.string().min(1).max(240),taskKey:z.string().min(1).max(240),title:z.string().trim().min(1).max(240).optional()})).output(z.object({threadId:Id})),
    /** The server checks the title (1-120 characters, one line) and explains a refusal. */
    rename: oc.input(z.object({botId:Id,taskThreadId:Id,title:z.string().max(1000)})).output(z.object({threadId:Id,title:z.string()})),
    /** Lifecycle fields come from the thread; older servers omit them. */
    list: oc.input(z.object({botId:Id,projectKey:z.string().min(1).max(240).optional()})).output(z.array(SideThreadSchema)),
    /** Pending questions, approvals and takeovers of the Mico's open conversations, newest first. */
    requests: oc.input(z.object({botId:Id})).output(z.array(SideThreadRequestSchema).max(50)),
    /** Stops the conversation (queued messages, runs, delegated work), then archives it. */
    archive: oc.input(SideThreadTargetSchema).output(z.object({ok:z.literal(true),archivedAt:IsoDate})),
    /** Undoes a pending delete, or else reopens an archived conversation. */
    restore: oc.input(SideThreadTargetSchema).output(z.object({ok:z.literal(true),restored:z.enum(["delete","archive","none"])})),
    /** Hides the conversation and removes it after `deleteAfter` unless it is restored first. */
    remove: oc.input(SideThreadTargetSchema).output(z.object({ok:z.literal(true),deleteAfter:IsoDate})),
    /** Copies a finished turn into a new conversation of the same Mico; refused while the source works. */
    branch: oc.input(BranchConversationInputSchema).output(BranchConversationOutputSchema),
  },
  threads: {
    pinned: oc.input(threadTarget).output(z.object({threadId:Id,pins:z.array(MessagePinSchema)})),
    setPin: oc.input(threadTarget.safeExtend({messageId:Id,pinned:z.boolean()})).output(z.object({ok:z.literal(true)})),
    /** Messages in this conversation that match, newest first, for in-chat search. */
    searchMessages: oc.input(threadTarget.safeExtend({q:z.string().trim().min(1).max(200)})).output(ThreadSearchOutputSchema),
    sideQuestionAvailable: oc.input(threadTarget).output(z.object({
      available: z.boolean(),
      extendedHistory: z.literal(true).optional(),
    })),
    sideQuestion: oc.input(threadTarget.safeExtend({
      question: z.string().trim().min(1).max(8000),
      earlier: z.array(z.object({ question: z.string().max(8000), answer: z.string().max(32000) })).max(20),
      extendedHistory: z.literal(true).optional(),
      responseLocale: z.string().max(16).optional(),
    })).output(z.object({ answer: z.string().max(32000) })),

    prepareProject: oc.input(z.object({
      botId: Id,
      taskThreadId: Id.optional(),
      requestId: z.string().uuid(),
      prompt: z.string().trim().min(1).max(16000),
      responseLocale: z.string().max(16).optional(),
    })).output(z.object({ runId: Id, taskId: Id })),
    projectPreparation: oc.input(z.object({ botId: Id, taskThreadId: Id.optional(), runId: Id }))
      .output(z.object({ status: z.string(), detail: z.string().max(8000) })),
    stopProjectPreparation: oc.input(z.object({ botId: Id, taskThreadId: Id.optional(), runId: Id }))
      .output(z.object({ ok: z.literal(true) })),
    head: oc.input(threadTarget).output(
      z.object({
        threadId: Id,
        cursor: z.number().int().min(-1),
      }),
    ),
    get: oc.input(threadTarget.safeExtend({ history: z.literal("recent").optional() })).output(ThreadSnapshotSchema),
    retry: oc.input(threadTarget.safeExtend({ runId: Id })).output(z.object({ ok: z.literal(true) })),
    messages: oc
      .input(
        threadTarget.safeExtend({
          before: z.number().int().nonnegative().optional(),
          includePeerRuns: z.boolean().optional(),
          includePeerReceipts: z.boolean().optional(),
          around: z
            .object({
              messageId: Id.optional(),
              seq: z.number().int().nonnegative().optional(),
            })
            .optional(),
        }),
      )
      .output(ThreadMessagePageSchema),
    subscribe: oc
      .input(threadTarget.safeExtend({ cursor: z.number().int().min(-1) }))
      .output(eventIterator(ProductEventSchema)),
    queue: oc.input(threadTarget).output(z.array(z.object({ messageId: Id, text: z.string(), createdAt: z.string() }))),
    /** The waiting messages with their order, edits, why they wait and whether Steer now applies. */
    queueState: oc.input(threadTarget).output(MessageQueueStateSchema),
    /** Steer now: the message joins the running turn as a correction (refused during a routine). */
    queueSteer: oc.input(queuedMessageTarget).output(z.object({ ok: z.literal(true) })),
    /** Send now: stops the current turn here and starts this message next. */
    queueSendNow: oc.input(queuedMessageTarget).output(z.object({ ok: z.literal(true), runId: Id.optional() })),
    /** Removes a message that still waits; `force` confirms one being edited somewhere else. */
    queueDelete: oc.input(queuedMessageTarget.safeExtend({ force: z.boolean().optional() })).output(z.object({ ok: z.literal(true) })),
    /** Opens an edit, which pauses the queue at this message until Save or Cancel; `takeOver` moves one open elsewhere here. */
    queueEdit: oc.input(queuedMessageTarget.safeExtend({ holdId: QueueHoldIdSchema, takeOver: z.boolean().optional() })).output(
      z.object({ text: z.string(), draft: z.string().nullable() }),
    ),
    /** Keeps the unsaved text of an open edit. */
    queueEditDraft: oc.input(queuedMessageTarget.safeExtend({ holdId: QueueHoldIdSchema, draft: z.string().max(MESSAGE_QUEUE_EDIT_MAX_LENGTH) }))
      .output(z.object({ ok: z.literal(true) })),
    /** Saves the edit: the new text replaces the message, and the queue continues. */
    queueEditSave: oc.input(queuedMessageTarget.safeExtend({ holdId: QueueHoldIdSchema, text: z.string().max(MESSAGE_QUEUE_EDIT_MAX_LENGTH) }))
      .output(z.object({ ok: z.literal(true) })),
    /** Cancels the edit; `gone` says the message no longer waits (it started or was removed). */
    queueEditCancel: oc.input(queuedMessageTarget.safeExtend({ holdId: QueueHoldIdSchema }))
      .output(z.object({ ok: z.literal(true), gone: z.boolean() })),
    /** Reorders the first messages; `expected` is the order shown, refused when it changed. */
    queueReorder: oc.input(threadTarget.safeExtend({
      expected: z.array(Id).min(1).max(MESSAGE_QUEUE_REORDER_LIMIT),
      order: z.array(Id).min(1).max(MESSAGE_QUEUE_REORDER_LIMIT),
    })).output(z.object({ ok: z.literal(true) })),
    /** Moves a waiting message to this Mico into a new conversation of its own, which starts with it. */
    queueMove: oc.input(queuedMessageTarget.safeExtend({ responseLocale: z.string().max(16).optional() }))
      .output(z.object({ threadId: Id, runId: Id, title: z.string() })),
    send: oc.input(threadSendInput).output(
      z.object({
        taskId: Id,
        runId: Id,
        seq: z.number().int(),
        messageId: Id.optional(),
        runIds: z.array(Id).optional(),
      }),
    ),
    react: oc
      .input(
        threadTarget.safeExtend({
          messageId: Id,
          reaction: MessageReactionSchema,
          clientNonce: z.string().min(1).max(200),
        }),
      )
      .output(z.object({ ok: z.literal(true), runIds: z.array(Id).optional() })),
    stop: oc.input(threadTarget).output(z.object({ ok: z.literal(true) })),
    followUp: oc
      .input(
        threadTarget.safeExtend({
          text: z.string().min(1),
          /** Carries the call id, so a turn taken mid-run stays in the call's card. */
          clientNonce: z.string().min(1).max(200).optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    /** The client hung up: close the call card and let the bot finish what was asked on it. */
    endCall: oc
      // ":" separates the call id from the nonce suffix, so it can never appear inside one.
      .input(
        botId.safeExtend({
          callId: z
            .string()
            .min(1)
            .max(200)
            .regex(/^[^:]+$/),
          /** How long the call was connected, measured from pickup on the caller's client. */
          durationSeconds: z
            .number()
            .int()
            .nonnegative()
            .max(7 * 24 * 60 * 60)
            .optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    /** The user picked up the bot's call: returns what the bot opens with. */
    answerCall: oc
      .input(
        botId.safeExtend({
          callId: z
            .string()
            .min(1)
            .max(200)
            .regex(/^[^:]+$/),
        }),
      )
      .output(z.object({ opening: z.string(), reason: z.string() })),
    /** The user turned the bot's call down, asked for it later, or it rang out. */
    declineCall: oc
      .input(
        botId.safeExtend({
          callId: z
            .string()
            .min(1)
            .max(200)
            .regex(/^[^:]+$/),
          outcome: z.enum(["declined", "missed"]),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    newChat: oc.input(threadTarget.and(z.object({ clientNonce: z.string().min(1).max(128) }))).output(z.object({ ok: z.literal(true) })),
    compactContext: oc.input(threadTarget).output(z.object({ queued: z.boolean() })),
    deleteOwnMessage: oc.input(threadTarget.safeExtend({ messageId: Id })).output(z.object({ ok: z.literal(true) })),
    clear: oc.input(threadTarget).output(z.object({ ok: z.literal(true) })),
    answer: oc
      .input(
        threadTarget
          .safeExtend({
            runId: Id,
            messageId: Id,
            answer: z.string(),
            /** Carries the call id for an answer spoken during a call. */
            clientNonce: z.string().min(1).max(200).optional(),
            /** Only for a login card; `answer` carries its password. */
            username: z.string().min(1).max(512).optional(),
            /** Turns down a pending secret request; `answer` is then empty. */
            dismiss: z.literal(true).optional(),
          })
          .refine(
            (input) =>
              input.dismiss
                ? input.answer === "" && !input.username && !input.clientNonce
                : input.answer.length > 0,
            "Send either an answer or a dismissal",
          ),
      )
      .output(z.object({ ok: z.literal(true) })),
    /** `unreadAfterSeq`: the seq read up to before this call, null when nothing was unread. */
    markRead: oc
      .input(threadTarget)
      .output(z.object({ ok: z.literal(true), unreadAfterSeq: z.number().int().nullable() })),
    /**
     * With `messageId`, the chat reads as unread from that message: the next open puts New above it.
     * Without it, the newest reply becomes unread.
     */
    markUnread: oc
      .input(threadTarget.and(z.object({ messageId: Id.optional() })))
      .output(z.object({ ok: z.literal(true) })),
    /**
     * Reads every chat at once in this Space: with `botId`, that Mico's main chat and all of its
     * open conversations; without it, every main chat, group and open conversation of the person.
     */
    markAllRead: oc
      .input(z.object({ botId: Id.optional() }))
      .output(z.object({ ok: z.literal(true), threads: z.number().int().nonnegative() })),
  },
  computer: {
    status: oc.input(botId).output(ComputerStatusSchema),
    boot: oc.input(botId).output(ComputerStatusSchema),
    stop: oc.input(botId).output(ComputerStatusSchema),
    recover: oc.input(botId).output(ComputerUpdateSchema),
    reset: oc.input(botId).output(ComputerStatusSchema),
    update: oc.input(botId).output(ComputerUpdateSchema),
    updates: oc.output(z.array(ComputerUpdateSchema)),
    releaseInterrupted: oc
      .input(z.object({ id: Id, workersStopped: z.literal(true) }))
      .output(z.object({ ok: z.literal(true) })),
    dismissUpdate: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
    takeover: oc.input(botId.extend({ runId: Id.optional() })).output(z.object({ leaseId: Id, expiresAt: z.string() })),
    focusBrowserTab: oc
      .input(z.object({ botId: Id, runId: Id }))
      .output(z.object({ state: z.enum(["focused", "unavailable", "unsupported"]) })),
    /** The waiting conversation's browser tab, streamed while the user holds control. */
    tabViewUrl: oc
      .input(z.object({ botId: Id, runId: Id }))
      .output(z.object({ url: z.string().nullable() })),
    release: oc
      .input(
        z.object({
          botId: Id,
          reason: ComputerReleaseReasonSchema.optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    input: oc
      .input(
        z.object({
          botId: Id,
          kind: z.enum(["key", "pointer", "clipboard", "scroll"]),
          payload: z.record(z.string(), z.unknown()),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    files: oc
      .input(z.object({ botId: Id, path: z.string().default("/") }))
      .output(
        z.array(z.object({ path: z.string(), kind: z.enum(["file", "dir"]), size: z.number() })),
      ),
    readFile: oc
      .input(z.object({ botId: Id, path: z.string() }))
      .output(z.object({ path: z.string(), content: z.string() })),
    downloadFile: oc
      .input(z.object({ botId: Id, path: z.string().min(1) }))
      .output(z.object({ path: z.string(), contentBase64: z.string() })),
    uploadFile: oc
      .input(
        z.object({
          botId: Id,
          path: z.string().min(1),
          contentBase64: z.string(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    terminalUrl: oc.input(botId).output(z.object({ url: z.string().nullable() })),
    commands: oc
      .input(botId)
      .output(z.array(ComputerCommandSchema.extend({ createdAt: z.string() }))),
    screenUrl: oc.input(botId).output(z.object({ url: z.string().nullable() })),
    heartbeat: oc.input(botId).output(z.object({ ok: z.literal(true) })),
  },
  memory: {
    reviewStatus: oc.output(z.object({reservedMicrounits:z.number().int(),chargedMicrounits:z.number().int(),pending:z.number().int()})),
    list: oc
      .input(z.object({ botId: Id.optional(), scope: z.enum(["bot", "user"]).optional(), taskThreadId: Id.optional() }))
      .output(z.array(MemoryDocumentSchema)),
    update: oc
      .input(
        z.object({
          documentId: Id,
          content: z.string(),
          inclusion: z.enum(["essential","searchable"]).optional(),
          expectedRevision: z.number().int().positive().optional(),
        }),
      )
      .output(MemoryDocumentSchema),
    remove: oc.input(z.object({ documentId: Id })).output(z.object({ ok: z.literal(true) })),
    exportMarkdown: oc.input(z.object({ botId: Id.optional() })).output(z.string()),
    providerConfig: oc.output(SpaceMemoryConfigSchema.nullable()),
    connectProvider: oc
      .input(
        z.object({
          provider: z.string().min(1),
          settings: z.record(z.string(), z.string()),
          credentials: z.record(z.string(), z.string()),
          defaultMemoryScope: MemoryScopeSchema.default("isolated"),
        }),
      )
      .output(SpaceMemoryConfigSchema),
    setDefaultScope: oc
      .input(z.object({ defaultMemoryScope: MemoryScopeSchema }))
      .output(SpaceMemoryConfigSchema),
    disconnectProvider: oc.output(z.object({ ok: z.literal(true) })),
    /** Personal memory servers over the open Memory MCP profile (specs/mcp-memory). */
    connections: {
      list: oc.output(z.array(MemoryConnectionSchema)),
      create: oc.input(MemoryConnectionCreateInput).output(MemoryConnectionSchema),
      /** List the server's tools and record whether they implement the profile. */
      check: oc.input(z.object({ id: Id })).output(MemoryConnectionSchema),
      remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
    },
    /** Which Micos may read each personal memory. Only a person changes them. */
    grants: {
      list: oc.output(z.array(MicoMemoryGrantSchema)),
      set: oc.input(MemoryGrantsSetInput).output(z.array(MicoMemoryGrantSchema)),
    },
  },
  workflows: {
    list: oc.output(z.array(WorkflowSchema)),
    available: oc.output(z.object({ enabled: z.literal(true) })),
    create: oc.input(z.object({ id: Id.optional(), name: z.string().trim().min(1).max(160), graph: WorkflowGraphSchema })).output(WorkflowSchema),
    save: oc.input(z.object({ id: Id, expectedVersion: z.number().int().positive(), name: z.string().trim().min(1).max(160), graph: WorkflowGraphSchema, active: z.boolean() })).output(WorkflowSchema),
    archive: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
    execute: oc.input(z.object({ id: Id, triggerId: Id, expectedVersion: z.number().int().positive(), clientNonce: z.string().min(1).max(160) })).output(WorkflowExecutionSchema),
    runs: oc.input(z.object({ id: Id })).output(z.array(WorkflowExecutionSchema)),
    stop: oc.input(z.object({ executionId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  routines: {
    calendar: oc.input(RoutineCalendarInputSchema).output(RoutineCalendarSchema),
    mentions: oc.input(z.object({})).output(z.array(RoutineSchema.pick({
      id: true, botId: true, name: true, crons: true,
    }))),
    list: oc.input(botId).output(z.array(RoutineSchema)),
    history: oc
      .input(z.object({ routineId: Id, before: RoutineRunCursorSchema.optional() }))
      .output(RoutineHistorySchema),
    create: oc.input(CreateRoutineInput).output(RoutineSchema),
    update: oc
      .input(
        z
          .object({
            routineId: Id,
            name: z.string().optional(),
            prompt: z.string().optional(),
            crons: z.array(z.string().min(1)).optional(),
            timezone: TimeZoneSchema.optional(),
            active: z.boolean().optional(),
            notify: z.boolean().optional(),
            webhookEnabled: z.boolean().optional(),
            githubEnabled: z.boolean().optional(),
            messageProvider: z
              .string()
              .min(1)
              .max(50)
              .regex(/^[a-z0-9._-]+$/i)
              .nullable()
              .optional(),
            /** Null clears the routine's own model and runs it on the bot's. */
            modelProvider: z.string().trim().min(1).max(80).nullable().optional(),
            modelId: z.string().trim().min(1).max(200).nullable().optional(),
            thinkingLevel: ThinkingLevelSchema.nullable().optional(),
            /** ISO datetime to arm a never-run one-shot. */
            runAt: IsoDate.optional(),
            /** Null removes the change trigger. */
            watch: RoutineWatchSchema.nullable().optional(),
            /** Moves the routine's runs; a group routine keeps its group. */
            runIn: RoutineRunInChoiceSchema.optional(),
          })
          .superRefine((value, ctx) => {
            if (
              value.crons &&
              value.crons.length === 0 &&
              value.webhookEnabled === false &&
              value.githubEnabled === false &&
              value.messageProvider === null &&
              value.watch === null
            ) {
              ctx.addIssue({
                code: "custom",
                message: "Add a schedule, webhook, GitHub, message, or change trigger",
                path: ["crons"],
              });
            }
          }),
      )
      .output(RoutineSchema),
    remove: oc.input(z.object({ routineId: Id })).output(z.object({ ok: z.literal(true) })),
    testRun: oc
      .input(
        z.object({
          routineId: Id,
          clientNonce: z.string().min(1).max(200).optional(),
        }),
      )
      .output(z.object({ runId: Id, taskThreadId: Id.optional(), groupId: Id.optional() })),
  },
  scratchpad: {
    list: oc
      .input(
        z.object({
          botId: Id,
          status: ScratchpadItemStatusSchema.optional(),
          includeDone: z.boolean().optional(),
        }),
      )
      .output(z.array(ScratchpadItemSchema)),
    create: oc.input(CreateScratchpadItemInput).output(ScratchpadItemSchema),
    update: oc
      .input(
        z.object({
          itemId: Id,
          title: z.string().min(1).max(200).optional(),
          status: ScratchpadItemStatusSchema.optional(),
          notes: z.string().max(4_000).optional(),
        }),
      )
      .output(ScratchpadItemSchema),
    remove: oc.input(z.object({ itemId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  boards: {
    list: oc.output(z.array(BoardSchema)),
    get: oc.output(BoardSchema),
    rename: oc.input(RenameBoardInput).output(BoardSchema),
    subscribe: oc.output(eventIterator(BoardEventSchema)),
  },
  tickets: {
    list: oc.input(ListTicketsInput).output(ListTicketsOutput),
    get: oc.input(GetTicketInput).output(TicketSchema),
    create: oc.input(CreateTicketInput).output(TicketSchema),
    update: oc.input(UpdateTicketInput).output(TicketSchema),
    move: oc.input(MoveTicketInput).output(TicketSchema),
    comment: oc.input(CommentTicketInput).output(TicketCommentSchema),
    comments: oc.input(z.object({ ticketId: Id })).output(z.array(TicketCommentSchema)),
  },
  skills: {
    list: oc.input(botId).output(z.array(TaughtSkillSchema)),
    get: oc.input(z.object({ skillId: Id })).output(TaughtSkillSchema),
    start: oc
      .input(z.object({ botId: Id, goal: z.string().min(1).max(4000) }))
      .output(TaughtSkillSchema),
    appendEvent: oc
      .input(z.object({ skillId: Id, event: TeachRecordingEventSchema }))
      .output(TaughtSkillSchema),
    snapshot: oc.input(z.object({ skillId: Id })).output(TaughtSkillSchema),
    stop: oc.input(z.object({ skillId: Id })).output(TaughtSkillSchema),
    updateDraft: oc
      .input(
        z.object({
          skillId: Id,
          name: z.string().optional(),
          playbook: SkillPlaybookSchema,
        }),
      )
      .output(TaughtSkillSchema),
    save: oc
      .input(z.object({ skillId: Id, name: z.string().optional() }))
      .output(TaughtSkillSchema),
    testRun: oc
      .input(z.object({ skillId: Id, prompt: z.string().optional() }))
      .output(z.object({ runId: Id })),
    remove: oc.input(z.object({ skillId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  /** Claude Agent Skills (SKILL.md recipes) shared across assistants (not taught/demo skills). Pi already understands this format; we persist and inject them. */
  agentSkills: {
    pin: oc
      .input(z.object({ botId: Id, skillId: Id, revision: z.number().int().positive().nullable() }))
      .output(z.object({ ok: z.literal(true) })),
    list: oc.output(z.array(AgentSkillCatalogEntrySchema)),
    get: oc
      .input(
        z
          .object({ skillId: Id.optional(), name: z.string().min(1).max(80).optional() })
          .superRefine((input, ctx) => {
            if (!input.skillId && !input.name?.trim()) {
              ctx.addIssue({
                code: "custom",
                message: "Provide skillId or name",
                path: ["skillId"],
              });
            }
          }),
      )
      .output(AgentSkillSchema),
    create: oc.input(CreateAgentSkillInput).output(AgentSkillSchema),
    update: oc.input(UpdateAgentSkillInput).output(AgentSkillSchema),
    history: oc
      .input(z.object({ skillId: Id, before: z.number().int().positive().optional() }))
      .output(z.array(AgentSkillSchema)),
    restore: oc
      .input(
        z.object({
          skillId: Id,
          revision: z.number().int().positive(),
          expectedRevision: z.number().int().positive(),
        }),
      )
      .output(AgentSkillSchema),
    remove: oc.input(z.object({ skillId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  capabilities: {
    list: oc.output(z.array(CapabilityInstallSchema)),
    catalogSearch: oc
      .input(
        z.object({
          query: z.string().trim().max(253).default(""),
          usePublicCatalog: z.boolean().default(false),
        }),
      )
      .output(
        z.object({
          enabled: z.boolean(),
          results: z.array(IntegrationCatalogResultSchema),
        }),
      ),
    install: oc
      .input(
        z.object({
          kind: z.enum(["skill", "plugin", "mcp", "api", "graphql"]),
          name: z.string().min(1).max(120),
          source: z.string().min(1).max(2048),
          config: z.record(z.string(), z.unknown()).default({}),
          credential: z.string().max(16_384).optional(),
        }),
      )
      .output(CapabilityInstallSchema),
    remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
  },
  tailscale: {
    list: oc.output(z.object({ available: z.boolean(), admin: z.boolean(), companyNetworks: z.array(z.object({ id: Id, dnsSuffix: TailnetSuffix, enabled: z.boolean() })), connections: z.array(TailnetConnectionSchema) })),
    create: oc.input(TailnetConnectionInput).output(TailnetConnectionSchema),
    connect: oc.input(z.object({ id: Id })).output(TailnetConnectionSchema),
    disconnect: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
    grant: oc.input(z.object({ id: Id, allowedBotIds: z.array(Id).max(100) })).output(z.object({ ok: z.literal(true) })),
    company: oc.input(z.object({ dnsSuffix: TailnetSuffix, enabled: z.boolean() })).output(z.object({ ok: z.literal(true) })),
  },
  mcp: {
    servers: {
      list: oc.output(z.array(McpServerSchema)),
      create: oc.input(McpServerConfigInput).output(McpServerSchema),
      update: oc
        .input(
          z.union([
            z.object({ id: Id, config: McpServerConfigInput }),
            z.object({ id: Id, secret: z.string().min(1).max(16384) }),
          ]),
        )
        .output(McpServerSchema),
      remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
      /** Launch the server once (installing a stdio package if needed), list its tools, close it. */
      test: oc.input(z.object({ id: Id })).output(McpServerSchema),
    },
    assignments: {
      list: oc.input(botId).output(z.array(BotMcpServerSchema)),
      all: oc.output(z.array(BotMcpServerSchema)),
      approve: oc
        .input(z.object({ botId: Id, serverId: Id, threadId: Id.optional() }))
        .output(BotMcpServerSchema),
      dismiss: oc
        .input(z.object({ botId: Id, serverId: Id, threadId: Id.optional() }))
        .output(z.object({ ok: z.literal(true) })),
      replace: oc
        .input(
          z.object({
            botId: Id,
            assignments: z.array(
              z.object({
                serverId: Id,
                allowAllTools: z.boolean().default(true),
                allowedTools: z.array(z.string().min(1).max(200)).max(500).default([]),
              }),
            ),
          }),
        )
        .output(z.array(BotMcpServerSchema)),
    },
    oauth: {
      begin: oc.input(z.object({ serverId: Id, redirectUri: z.string().url() })).output(
        z.discriminatedUnion("status", [
          z.object({
            status: z.literal("authorization_required"),
            sessionId: Id,
            authorizationUrl: z.string().url(),
          }),
          z.object({
            status: z.enum(["already_connected", "authorization_not_requested"]),
          }),
        ]),
      ),
      complete: oc
        .input(z.object({ sessionId: Id, code: z.string().min(1), state: z.string().min(1) }))
        .output(z.object({ ok: z.literal(true) })),
      disconnect: oc.input(z.object({ serverId: Id })).output(z.object({ ok: z.literal(true) })),
    },
  },
  onboarding: {
    /** Record the optional signup survey; an empty submission marks it skipped. */
    signupSurvey: oc.input(SignupSurveySchema).output(z.object({ ok: z.literal(true) })),
    /** Seed the first-run greeting into the bot's thread (focus card is separate). */
    start: oc.input(z.object({ botId: Id })).output(z.object({ ok: z.literal(true) })),
    /** Post the focus choice card when the thread is still idle. */
    promptFocus: oc.input(z.object({ botId: Id })).output(z.object({ ok: z.literal(true) })),
    /** Answer the focus choice; posts the app cards. Does not rename the bot. */
    choose: oc
      .input(z.object({ botId: Id, optionId: z.string() }))
      .output(z.object({ ok: z.literal(true) })),
    /** Dismiss the unanswered focus card without choosing an option. */
    dismissFocus: oc.input(z.object({ botId: Id })).output(z.object({ ok: z.literal(true) })),
    /** Flip an app_connect card to connected after authorization completes. */
    appConnected: oc
      .input(
        z.object({
          botId: Id,
          threadId: Id.optional(),
          /** The card's own message, so it is found however far back it is. */
          messageId: Id.optional(),
          provider: z.string(),
          connectorId: z.string().default("composio"),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
  },
  integrationSetup: {
    get: oc.output(IntegrationSetupStateSchema),
    save: oc.input(IntegrationProviderConfigSchema).output(z.object({ ok: z.literal(true) })),
  },
  connections: {
    catalog: oc
      .input(z.object({ query: z.string().optional(), connectorId: z.string().optional() }))
      .output(z.array(ConnectionCatalogItemSchema)),
    list: oc.output(z.array(ConnectionSchema)),
    accounts: oc
      .input(z.object({ connectorId: z.string(), provider: z.string() }))
      .output(z.array(ConnectionSchema)),
    begin: oc
      .input(
        z.object({
          connectorId: z.string().default("composio"),
          provider: z.string(),
          displayName: z.string(),
        }),
      )
      .output(z.object({ connectionId: Id, authorizationUrl: z.string().nullable() })),
    complete: oc
      .input(z.object({ connectionId: Id, code: z.string().optional() }))
      .output(ConnectionSchema),
    rename: oc
      .input(
        z.object({
          connectionId: Id,
          displayName: z.string().trim().min(1).max(CONNECTION_LABEL_MAX_LENGTH),
        }),
      )
      .output(ConnectionSchema),
    revoke: oc.input(z.object({ connectionId: Id })).output(z.object({ ok: z.literal(true) })),
    /** Tools the connected provider exposes. Read-only; no per-tool allowlist yet. */
    tools: oc.input(z.object({ connectorId: z.string(), provider: z.string() })).output(
      z.array(
        z.object({
          name: z.string(),
          description: z.string(),
        }),
      ),
    ),
  },
  /** External messaging surface: link state, group channels, agent connections. */
  messaging: {
    installations: {
      list: oc.output(MessagingInstallationsStatusSchema),
      start: oc.input(z.object({ botId: Id })).output(z.object({ url: z.string() })),
      remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
    },
    status: oc.output(MessagingStatusSchema),
    link: {
      /** Issue a short-lived code the user sends to the line from a chat app. */
      start: oc
        .input(z.object({ botId: Id }))
        .output(z.object({ code: z.string(), expiresAt: z.string() })),
    },
    identities: {
      setBot: oc
        .input(z.object({ identityId: Id, botId: Id }))
        .output(MessagingLinkedIdentitySchema),
      unlink: oc.input(z.object({ identityId: Id })).output(z.object({ ok: z.literal(true) })),
    },
    channels: {
      list: oc.output(z.array(MessagingChannelMembershipSchema)),
      // Addressed by membership, not channel: one user can have two linked
      // chat apps in the same group, and each answers for its own agent.
      respond: oc
        .input(z.object({ membershipId: Id, accept: z.boolean() }))
        .output(MessagingChannelMembershipSchema),
      leave: oc.input(z.object({ membershipId: Id })).output(z.object({ ok: z.literal(true) })),
    },
    connections: {
      list: oc.output(z.array(MessagingAgentConnectionSchema)),
      respond: oc
        .input(z.object({ connectionId: Id, accept: z.boolean() }))
        .output(MessagingAgentConnectionSchema),
      revoke: oc.input(z.object({ connectionId: Id })).output(z.object({ ok: z.literal(true) })),
    },
  },
  /** WhatsApp numbers linked to this account through Mycellios Desktop. */
  whatsapp: {
    links: {
      list: oc.output(z.array(WhatsAppLinkSchema)),
      setBot: oc.input(z.object({ linkId: Id, botId: Id })).output(WhatsAppLinkSchema),
      /** Forget the link; the Desktop that holds the session logs it out on its next sync. */
      remove: oc.input(z.object({ linkId: Id })).output(z.object({ ok: z.literal(true) })),
    },
    senders: {
      add: oc.input(WhatsAppSenderAddInput).output(WhatsAppSenderSchema),
      respond: oc
        .input(z.object({ senderId: Id, accept: z.boolean() }))
        .output(WhatsAppSenderSchema),
      remove: oc.input(z.object({ senderId: Id })).output(z.object({ ok: z.literal(true) })),
    },
  },
  approvalRules: {
    list: oc.input(settingsScopeInput.optional()).output(z.array(ActionApprovalRuleSchema)),
    set: oc
      .input(
        settingsScopeInput.extend({
          effect: z.enum(["always_allow", "deny"]),
          matchKind: z.enum(["tool", "connector", "site"]),
          matchValue: z.string().min(1),
        }),
      )
      .output(ActionApprovalRuleSchema),
    remove: oc
      .input(settingsScopeInput.extend({ id: Id }))
      .output(z.object({ ok: z.literal(true) })),
  },
  autoReview: {
    get: oc.input(settingsScopeInput.optional()).output(ActionAutoReviewSettingsSchema),
    set: oc
      .input(
        settingsScopeInput.extend({
          mode: ApprovalModeSchema.optional(),
          enabled: z.boolean().optional(),
          skipApprovals: z.boolean().optional(),
        }),
      )
      .output(ActionAutoReviewSettingsSchema),
  },
  /** Which account settings the bound Space overrides for the member. */
  spaceSettings: {
    overrides: oc.output(z.array(SpaceSettingSchema)),
    /** Customizing copies the account's settings into the Space; ending it drops the copy. */
    setOverride: oc
      .input(z.object({ setting: SpaceSettingSchema, enabled: z.boolean() }))
      .output(z.array(SpaceSettingSchema)),
  },
  appCovers: {
    get: oc.input(z.object({ appId: AppCoverId })).output(z.object({
      revision: z.string().nullable(), image: ArtifactWithContentSchema.nullable(),
    })),
    set: oc.input(AppCoverWrite).output(z.object({
      revision: z.string().nullable(), image: ArtifactWithContentSchema.nullable(),
    })),
  },
  artifacts: {
    list: oc.input(botId).output(z.array(ArtifactSchema)),
    listSpace: oc
      .input(
        z.object({
          botId: Id.optional(),
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(60).optional(),
        }),
      )
      .output(
        z.object({
          items: z.array(ArtifactSchema.extend({ versionCount: z.number().int() })),
          nextCursor: z.string().nullable(),
        }),
      ),
    listVersions: oc.input(z.object({ familyId: Id })).output(z.array(ArtifactVersionSchema)),
    create: oc
      .input(
        threadTarget.and(
          z.object({
            name: z.string().min(1).max(ARTIFACT_NAME_MAX_LENGTH),
            description: z.string().max(ARTIFACT_DESCRIPTION_MAX_LENGTH).optional(),
            mimeType: z.string().min(1),
            contentBase64: z.string().min(1),
            /** Unique per upload; a retry with the same nonce returns the artifact it created. */
            clientNonce: z.string().min(1).max(200).optional(),
          }),
        ),
      )
      .output(ArtifactSchema),
    get: oc.input(threadTarget.and(z.object({ artifactId: Id }))).output(ArtifactWithContentSchema),
    getById: oc.input(z.object({ artifactId: Id })).output(ArtifactWithContentSchema),
    remove: oc.input(z.object({ artifactId: Id })).output(z.object({ ok: z.literal(true) })),
    /** The family's share link, or null. Reading it never creates one. */
    getShare: oc.input(z.object({ artifactId: Id })).output(ArtifactShareSchema.nullable()),
    /** Share this exact version; an existing link keeps its address and moves to it. */
    share: oc.input(z.object({ artifactId: Id })).output(ArtifactShareSchema),
    /** Revoke the family's link: its address stops working for everyone. */
    unshare: oc.input(z.object({ artifactId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  usage: {
    sporeRewards: oc.output(SporeRewardsSchema),
    dashboard: oc.input(UsageDashboardInputSchema).output(UsageDashboardSchema),
    agents: oc.output(AgentUsageReportSchema),
    agent: oc.input(botId).output(TaskCostSchema.omit({ runId: true }).extend({ botId: Id, lastCall: LastModelCallSchema.nullable() })),
    tasks: oc.input(z.object({ runIds: z.array(Id).max(100) })).output(z.array(TaskCostSchema)),
    list: oc.output(z.array(UsageRecordSchema)),
    summary: oc.output(UsageSummarySchema),
  },
  export: {
    bot: oc.input(botId).output(ExportManifestSchema),
  },
  notifications: {
    androidStatus: oc.output(z.object({ configured: z.boolean() })),
    registerAndroidPush: oc.input(z.object({ token: z.string().min(20).max(4096).regex(/^\S+$/), expectedUserId: z.string().min(1).max(160), projectId: z.string().regex(/^[a-z][a-z0-9-]{4,62}$/) })).output(z.object({ ok: z.literal(true) })),
    webStatus: oc.input(z.object({ clientId: z.string().uuid() })).output(z.object({ configured: z.boolean(), publicKey: z.string().nullable(), registered: z.boolean(), settings: NotificationSettingsSchema, bots: z.array(z.object({ id: z.string(), name: z.string(), notifyOnFinish: z.boolean() })) })),
    webRegister: oc.input(z.object({ clientId: z.string().uuid(), subscription: WebPushSubscriptionSchema, expectedUserId: z.string().min(1).max(160).optional() })).output(z.object({ ok: z.literal(true) })),
    webUnregister: oc.input(z.object({ clientId: z.string().uuid() })).output(z.object({ ok: z.literal(true) })),
    webPresence: oc.input(z.object({ clientId: z.string().uuid(), focused: z.boolean() })).output(z.object({ ok: z.literal(true) })),
    settings: oc.output(NotificationSettingsSchema),
    saveSettings: oc.input(NotificationSettingsSchema).output(NotificationSettingsSchema),
    registerPush: oc
      // No whitespace: the token store keeps the registering session on the next line.
      .input(z.object({ token: z.string().min(8).max(512).regex(/^\S+$/) }))
      .output(z.object({ ok: z.literal(true) })),
    unregisterPush: oc.output(z.object({ ok: z.literal(true) })),
  },
  search: {
    /** `filter` narrows the results to one kind; older servers ignore it and return all. */
    query: oc.input(z.object({ q: z.string().max(200), filter: SearchFilterSchema.optional() })).output(SearchQueryOutputSchema),
  },
  /** Pins across one Mico's main chat and side conversations; not bound to an open conversation. */
  pins: {
    mico: oc.input(z.object({ botId: Id })).output(z.object({ pins: z.array(MicoMessagePinSchema).max(MICO_PINS_LIST_LIMIT) })),
    /** Removes a pin from the combined list, whoever made it. */
    unpin: oc.input(z.object({ botId: Id, threadId: Id, messageId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  links: {
    /**
     * The site icon for a link's origin as a small data URL, resolved and cached by the server.
     * `retry` means the server was too busy to look; the origin may still have an icon.
     */
    favicon: oc
      // The longest origin: a scheme, a 253-character host name and a port.
      .input(z.object({ origin: z.string().max("https://".length + 253 + ":65535".length) }))
      .output(z.object({ icon: z.string().nullable(), retry: z.boolean().optional() })),
  },
  taskInbox: {
    available: oc.output(z.object({ enabled: z.literal(true) })),
    list: oc.output(z.array(InboxTaskSchema)),
    start: oc.input(TaskInboxSendSchema.extend({ botId: Id })).output(InboxTaskSchema),
    read: oc.input(z.object({ id: Id })).output(z.object({ item: InboxTaskSchema, thread: ThreadSnapshotSchema })),
    messages: oc.input(z.object({ id: Id, before: z.number().int().nonnegative() })).output(ThreadMessagePageSchema),
    send: oc.input(TaskInboxSendSchema.extend({ id: Id })).output(z.object({ ok: z.literal(true) })),
    markRead: oc.input(z.object({ id: Id, seq: z.number().int().min(-1) })).output(z.object({ ok: z.literal(true) })),
    followUp: oc.input(z.object({ id: Id, pinned: z.boolean().optional(), remindAt: IsoDate.nullable().optional() }).refine(v => v.pinned !== undefined || v.remindAt !== undefined)).output(z.object({ ok: z.literal(true) })),
    archive: oc.input(z.object({ id: Id, archived: z.boolean() })).output(z.object({ ok: z.literal(true) })),
    stop: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
    answer: oc.input(z.object({ id: Id, runId: Id, messageId: Id, answer: z.string().max(16000), username: z.string().min(1).max(512).optional(), dismiss: z.literal(true).optional() }).refine(value => value.dismiss ? value.answer === "" && !value.username : value.answer.length > 0)).output(z.object({ ok: z.literal(true) })),
  },
  tasks: {
    overview: oc.output(z.array(z.object({ taskId: Id, runId: Id.nullable(), botId: Id, name: z.string(),
      threadId: Id, taskThreadId: Id.optional(), groupId: Id.optional(), status: z.string(), notify: z.boolean(), updatedAt: IsoDate }))),
    concurrency: oc.input(z.object({ botId: Id, limit: z.number().int().min(1).max(4).optional() }))
      .output(z.object({ limit: z.number().int(), effectiveLimit: z.number().int() })),
    work: oc.input(z.object({taskId:Id})).output(z.array(z.object({
      id:Id,botId:Id,parentTaskId:Id.nullable(),delegationState:z.string().nullable(),
      delegationRevision:z.number().int(),paused:z.boolean(),workStopPending:z.boolean(),
      expectedResult:z.string().nullable(),resources:z.array(z.string()),dependencies:z.array(Id),
      delegatedRunId:Id.nullable(),updatedAt:IsoDate,threadId:Id,result:z.string(),resultIsUntrustedData:z.boolean(),
        executionStatus:z.string().nullable().optional(),
    }))),
    controlWork: oc.input(z.object({taskId:Id,expectedRevision:z.number().int().nonnegative(),
      action:z.enum(['pause','resume','cancel','reassign']),botId:Id.optional()}))
      .output(z.object({taskId:Id,revision:z.number().int(),paused:z.boolean(),stopping:z.boolean()})),
    /** The open await_event waits of one of the Mico's conversations (its main chat or a side one). */
    waits: oc.input(z.object({ botId: Id, threadId: Id })).output(z.array(OpenWaitSchema)),
    /** "Cancel the wait": the existing durable cancellation; a wait that already woke is not cancelled. */
    cancelWait: oc.input(z.object({ waitId: Id })).output(CancelOpenWaitResultSchema),
    /** The "Waiting for replies" list of a Mico main chat: its requests to other Micos and delegated tasks. */
    awaitingReplies: oc.input(z.object({ botId: Id })).output(AwaitingRepliesSchema),
    /** Stop one recipient of a request; the request settles once every recipient has. */
    stopAwaitingReply: oc.input(StopAwaitingReplyInputSchema).output(z.object({ ok: z.literal(true) })),
    /** "Hide this list" on settled requests. */
    hideAwaitingReplies: oc.input(HideAwaitingRepliesInputSchema).output(z.object({ ok: z.literal(true) })),

    get: oc.input(z.object({ runId: Id })).output(
      z.object({
        taskId: Id,
        version: z.number().int(),
        paused: z.boolean(),
        active: z.boolean(),
        botId: Id,
        runId: Id,
        bots: z.array(z.object({ id: Id, name: z.string() })),
      }),
    ),
    control: oc
      .input(
        z.object({
          runId: Id,
          expectedVersion: z.number().int().positive(),
          action: z.enum(["pause", "resume", "reassign"]),
          botId: Id.optional(),
        }),
      )
      .output(z.object({ taskId: Id, version: z.number().int(), runId: Id, paused: z.boolean() })),
  },
  runs: {
    logs: oc.input(RunLogsInputSchema).output(RunLogsOutputSchema),
    list: oc.input(z.object({ filter: z.enum(["active", "recent"]) })).output(RunsListOutputSchema),
  },
  voice: {
    catalog: oc.output(z.array(VoiceCatalogEntrySchema)),
    status: oc.input(settingsScopeInput.optional()).output(VoiceStatusSchema),
    credentials: oc.input(settingsScopeInput.optional()).output(z.array(VoiceCredentialSchema)),
    connect: oc
      .input(
        z
          .object({
            provider: z.string(),
            /** Optional only for a self-hosted server, which may run without a key. */
            apiKey: z.string().max(4096).default(""),
            voiceId: z.string().max(120).optional(),
            speechModel: z.string().max(64).optional(),
            /** Self-hosted (OpenAI-compatible) server address and model ids. */
            baseUrl: z.string().max(2048).optional(),
            ttsModel: z.string().max(200).optional(),
            sttModel: z.string().max(200).optional(),
            /** Where the connection becomes the default voice. */
            scope: SettingsScopeSchema.optional(),
          })
          .superRefine((input, ctx) => {
            if (input.provider === OPENAI_COMPATIBLE_PROVIDER_ID) {
              if (!input.baseUrl?.trim()) {
                ctx.addIssue({ code: "custom", path: ["baseUrl"], message: "Enter a server URL." });
              }
            } else if (input.apiKey.length < 8) {
              ctx.addIssue({ code: "custom", path: ["apiKey"], message: "Enter an API key." });
            }
          }),
      )
      .output(VoiceCredentialSchema),
    disconnect: oc
      .input(z.object({ provider: z.string().min(1) }))
      .output(z.object({ ok: z.literal(true) })),
    setVoice: oc
      .input(
        settingsScopeInput.extend({
          voiceId: z.string().min(1).max(120),
          provider: z.string().optional(),
        }),
      )
      .output(VoiceStatusSchema),
    setSpeechModel: oc
      .input(
        settingsScopeInput.extend({
          provider: z.string().min(1),
          speechModel: z.string().max(64),
        }),
      )
      .output(VoiceCredentialSchema),
    voices: oc
      .input(settingsScopeInput.extend({ provider: z.string().optional() }))
      .output(z.array(VoiceInfoSchema)),
    prepare: oc
      .input(
        z.object({
          text: z.string().max(20000),
          voiceId: z.string().max(120).optional(),
          botId: Id.optional(),
          scope: SettingsScopeSchema.optional(),
        }),
      )
      .output(z.object({ ready: z.boolean(), utterances: z.array(z.string()) })),
  },
  externalConversations: {
    updatePolicy: oc
      .input(UpdateExternalConversationPolicyInput)
      .output(ExternalConversationPolicySchema),
  },
  agentSecrets: {
    list: oc.output(z.array(AgentSecretSchema)),
    put: oc.input(AgentSecretInputSchema).output(AgentSecretSchema),
    remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
  },
  botSecrets: {
    list: oc.input(z.object({ botId: Id })).output(z.array(BotSecretMetadata)),
    put: oc.input(BotSecretPutInput).output(BotSecretMetadata),
    remove: oc
      .input(z.object({ botId: Id, name: StoredBotSecretName }))
      .output(z.object({ ok: z.literal(true) })),
  },
};

export type AppContract = typeof appContract;

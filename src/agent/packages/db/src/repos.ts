import { createBotFolderRepos } from "./bot-folders.js";
import type { Actor, Bot, BotSection, MessageBlock, SpaceBot } from "@mycellios/contracts";
import {
  DEFAULT_COMPUTER_MODE,
  canonicalPiProviderId,
  InstructionVersionSchema,
  initialBotMemory,
} from "@mycellios/contracts";
import {
  BACKGROUND_RUN_TRIGGERS,
  displayName,
  isBackgroundRunTrigger,
  phoneCallSettings,
  ringingCall,
  userVisibleMessages,
} from "@mycellios/core";
import { chooseBotAvatar, chooseMicoAvatar } from "./bot-avatar-choice.js";
import type { Prisma, PrismaClient } from "./client.js";
import type { ComputerMode } from "./computers.js";
import { computerKindForMode, ensureComputerRecord, parseComputerMode } from "./computers.js";
import { rosterConversationSignals } from "./conversation-surfaces.js";
import { createThreadMessageInTransaction } from "./messages.js";
import type { SidebarPreviewMessage } from "./preview-messages.js";
import {
  NOT_QUIET_ROUTINE_RUN,
  newestThreadWindowFingerprints,
  withNewestThreadMessages,
} from "./preview-messages.js";
import { isQuietRoutineRunMarker } from "./routine-run-markers.js";
import { BotSectionNameConflictError, IsolationError } from "./scope.js";
import { lockSpaceForContentCreation } from "./spaces.js";
import {
  activeRunSelection,
  previewFromBlocks,
  primaryActiveRun,
  withLatestBotRuns,
} from "./thread-listing.js";
import { withTransactionRetry } from "./transaction-retry.js";

/** Newest messages loaded for sidebar preview; enough to skip a short peer-run tail. */
const SIDEBAR_PREVIEW_MESSAGE_WINDOW = 16;

/** A roster preview and the window fingerprint it was computed from. */
interface RosterPreview {
  fingerprint: string;
  preview: string;
  newest: { createdAt: Date } | undefined;
}

/**
 * Process-wide, by thread. An entry is only reused while its fingerprint still matches the
 * thread's current window, so it can never show a stale preview; the oldest entries leave first.
 */
const rosterPreviews = new Map<string, RosterPreview>();
const ROSTER_PREVIEW_CACHE_LIMIT = 5_000;

function rememberRosterPreview(threadId: string, entry: RosterPreview) {
  rosterPreviews.delete(threadId);
  rosterPreviews.set(threadId, entry);
  while (rosterPreviews.size > ROSTER_PREVIEW_CACHE_LIMIT) {
    const oldest = rosterPreviews.keys().next().value;
    if (oldest === undefined) break;
    rosterPreviews.delete(oldest);
  }
}

const rosterRunSelection = {
  ...activeRunSelection,
  select: { ...activeRunSelection.select, thread: { select: { taskBotId: true } } },
} as const;

function waitingTaskThreadId(botId: string, run: {
  status: string;
  threadId: string;
  thread?: { taskBotId: string | null };
} | undefined) {
  return run?.status === "waiting_input" && run.thread?.taskBotId === botId ? run.threadId : undefined;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

function isSpawnKeyConflict(error: unknown): boolean {
  if (!isUniqueViolation(error)) return false;
  const target = (error as { meta?: { target?: string[] | string } }).meta?.target;
  if (target == null) return true;
  const fields = Array.isArray(target) ? target : [target];
  return fields.some((field) => field === "spawnKey" || field.includes("spawnKey"));
}

function rosterRunErrorId(
  latestRun: { id: string; status: string } | undefined,
  activeRun: { status: string } | undefined,
): string | null {
  if (
    latestRun?.status !== "failed" ||
    activeRun?.status === "waiting_input" ||
    activeRun?.status === "waiting_takeover"
  ) {
    return null;
  }
  return latestRun.id;
}

// Roster rows show when the chat last moved. Bot.updatedAt also moves on settings, pin,
// section and reorder writes, so the newest message's time wins when the chat has one.
function rosterUpdatedAt(newestMessage: { createdAt: Date } | undefined, botUpdatedAt: Date) {
  return newestMessage?.createdAt ?? botUpdatedAt;
}

/**
 * The newest message the sidebar counts. A quiet routine run marker never is: it does not
 * become the preview and does not move the Mico up the list.
 */
function newestRosterMessage<T extends { blocks: unknown }>(messages: readonly T[]): T | undefined {
  return messages.find((message) => !isQuietRoutineRunMarker(message.blocks));
}

function mapBot(
  bot: {
    nativeConfig?: unknown;
    busyMessageMode?: string | null;
    id: string;
    spaceId: string;
    name: string;
    title: string;
    description: string;
    instructions: string;
    selfUpdateInstructions?: boolean;
    instructionHistory?: unknown;
    color: string;
    notifyOnFinish: boolean;
    pinned: boolean;
    sectionId: string | null;
    archivedAt: Date | null;
    parentBotId: string | null;
    memoryScope: string | null;
    createdAt: Date;
    updatedAt: Date;
    thread: { id: string; unread: boolean } | null;
    computer: { scope: string } | null;
    voiceId?: string | null;
    autoSpeak?: boolean;
    agentEngine?: string;
    modelProvider?: string | null;
    modelId?: string | null;
    thinkingLevel?: string | null;
    teamChatAmbientEnabled?: boolean;
    teamChatRules?: string;
    crossSpaceCommunication?: boolean;
    fleetManagement?: boolean;
    disabledBuiltinTools?: string[];
    webhookSecretId?: string | null;
    spawnKey?: string | null;
  },
  preview = "",
  status = "idle",
  runErrorId: string | null = null,
  updatedAt: Date = bot.updatedAt,
  incomingCall: Bot["incomingCall"] = null,
): Bot {
  if (!bot.thread) {
    throw new IsolationError("Bot is missing its thread");
  }
  return {
    id: bot.id,
    spaceId: bot.spaceId,
    name: bot.name,
    title: displayName(bot.title, ""),
    description: bot.description,
    instructions: bot.instructions,
    selfUpdateInstructions: bot.selfUpdateInstructions ?? false,
    instructionHistory: InstructionVersionSchema.array().parse(bot.instructionHistory ?? []),
    color: bot.color,
    notifyOnFinish: bot.notifyOnFinish,
    ...(bot.busyMessageMode === "queue" || bot.busyMessageMode === "steer"
      ? { busyMessageMode: bot.busyMessageMode }
      : {}),
    pinned: bot.pinned,
    sectionId: bot.sectionId,
    archivedAt: bot.archivedAt?.toISOString() ?? null,
    unread: bot.thread.unread,
    parentBotId: bot.parentBotId,
    memoryScope: bot.memoryScope as "isolated" | "shared" | null,
    threadId: bot.thread.id,
    preview,
    status,
    runErrorId,
    computerMode: bot.computer ? parseComputerMode(bot.computer.scope) : "team",
    createdAt: bot.createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    voiceId: bot.voiceId ?? null,
    autoSpeak: bot.autoSpeak ?? false,
    nativeConfig: (bot.nativeConfig ?? null) as Bot["nativeConfig"],
    agentEngine: (bot.agentEngine ?? "pi") as Bot["agentEngine"],
    modelProvider: bot.modelProvider ? canonicalPiProviderId(bot.modelProvider) : null,
    modelId: bot.modelId ?? null,
    thinkingLevel: (bot.thinkingLevel as Bot["thinkingLevel"]) ?? null,
    teamChatAmbientEnabled: bot.teamChatAmbientEnabled ?? false,
    teamChatRules: bot.teamChatRules ?? "",
    crossSpaceCommunication: bot.crossSpaceCommunication ?? false,
    fleetManagement: bot.fleetManagement ?? false,
    disabledBuiltinTools: bot.disabledBuiltinTools ?? [],
    webhookConfigured: Boolean(bot.webhookSecretId),
    spawnKey: bot.spawnKey ?? null,
    incomingCall,
  };
}

export function createRepos(
  prisma: PrismaClient,
  capabilities: { phoneCallsEnabled?: boolean; phoneCallRingSeconds?: number } = {},
) {
  async function listBotSectionsForSpaces(
    actor: Actor,
    spaceIds: string[],
  ): Promise<Array<BotSection & { spaceId: string }>> {
    if (spaceIds.length === 0) return [];
    const sections = await prisma.botSection.findMany({
      where: { spaceId: { in: spaceIds }, userId: actor.userId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    return sections.map((section) => ({
      id: section.id,
      spaceId: section.spaceId,
      name: section.name,
      parentId: section.parentId,
      position: section.position,
      createdAt: section.createdAt.toISOString(),
      updatedAt: section.updatedAt.toISOString(),
    }));
  }

  async function listSpaceBotsForSpaces(actor: Actor, spaceIds: string[]): Promise<SpaceBot[]> {
    if (spaceIds.length === 0) return [];
    const rows = await prisma.bot.findMany({
      where: {
        spaceId: { in: spaceIds },
        userId: actor.userId,
        archivedAt: null,
      },
      select: {
        id: true,
        spaceId: true,
        name: true,
        title: true,
        color: true,
        notifyOnFinish: true,
        pinned: true,
        sectionId: true,
        updatedAt: true,
        parentBotId: true,
        thread: {
          select: {
            id: true,
            unread: true,
          },
        },
        runs: rosterRunSelection,
      },
      orderBy: [{ pinned: "desc" }, { position: "asc" }, { createdAt: "asc" }],
    });
    const bots = await withNewestThreadMessages(prisma, await withLatestBotRuns(prisma, rows), 1, {
      skipQuietRoutineRuns: true,
    });
    const signals = await rosterConversationSignals(prisma, actor.userId,
      bots.flatMap((bot) => bot.thread ? [{ botId: bot.id, threadId: bot.thread.id, unread: bot.thread.unread }] : []));
    return bots.map((bot) => {
      if (!bot.thread) throw new IsolationError("Bot is missing its thread");
      const activeRun = primaryActiveRun(bot.runs);
      return {
        ...signals.get(bot.id),
        id: bot.id,
        spaceId: bot.spaceId,
        name: bot.name,
        title: displayName(bot.title, ""),
        color: bot.color,
        notifyOnFinish: bot.notifyOnFinish,
        pinned: bot.pinned,
        sectionId: bot.sectionId,
        unread: bot.thread.unread,
        parentBotId: bot.parentBotId,
        preview: previewFromBlocks(newestRosterMessage(bot.thread.messages)?.blocks),
        status: activeRun?.status ?? "idle",
        waitingTaskThreadId: waitingTaskThreadId(bot.id, activeRun),
        runErrorId: rosterRunErrorId(bot.thread.runs[0], primaryActiveRun(bot.runs, bot.thread.id)),
        updatedAt: rosterUpdatedAt(newestRosterMessage(bot.thread.messages), bot.updatedAt).toISOString(),
      };
    });
  }

  return {
    async listBotSections(actor: Actor): Promise<BotSection[]> {
      return listBotSectionsForSpaces(actor, [actor.spaceId]);
    },

    listBotSectionsForSpaces,

    ...createBotFolderRepos(prisma),

    async listBots(actor: Actor, options: { archived?: boolean } = {}): Promise<Bot[]> {
      const rows = await withLatestBotRuns(
        prisma,
        await prisma.bot.findMany({
          where: {
            spaceId: actor.spaceId,
            userId: actor.userId,
            archivedAt: options.archived ? { not: null } : null,
          },
          include: {
            thread: true,
            runs: rosterRunSelection,
            computer: { select: { scope: true } },
          },
          orderBy: [{ pinned: "desc" }, { position: "asc" }, { createdAt: "asc" }],
        }),
      );
      // Decrypting each Mico's newest messages is the costly part of the roster. A thread
      // whose window has not changed since its preview was computed reuses that preview.
      const fingerprints = await newestThreadWindowFingerprints(
        prisma,
        rows.flatMap((bot) => (bot.thread ? [bot.thread.id] : [])),
        SIDEBAR_PREVIEW_MESSAGE_WINDOW,
        { skipQuietRoutineRuns: true },
      );
      const reused = new Map<string, RosterPreview>();
      for (const bot of rows) {
        if (!bot.thread) continue;
        const cached = rosterPreviews.get(bot.thread.id);
        if (cached && cached.fingerprint === fingerprints.get(bot.thread.id))
          reused.set(bot.id, cached);
      }
      const loaded = new Map(
        (
          await withNewestThreadMessages(
            prisma,
            rows.filter((bot) => !reused.has(bot.id)),
            SIDEBAR_PREVIEW_MESSAGE_WINDOW,
            { skipQuietRoutineRuns: true },
          )
        ).map((bot) => [bot.id, bot]),
      );
      const bots = rows.map(
        (bot) =>
          loaded.get(bot.id) ?? {
            ...bot,
            thread: bot.thread ? { ...bot.thread, messages: [] as SidebarPreviewMessage[] } : null,
          },
      );
      const callThreadIds = capabilities.phoneCallsEnabled
        ? bots.flatMap((bot) => (bot.thread ? [bot.thread.id] : []))
        : [];
      const callMessages = callThreadIds.length
        ? await prisma.message.findMany({
            where: {
              threadId: { in: callThreadIds },
              createdAt: {
                gt: new Date(
                  Date.now() -
                    (capabilities.phoneCallRingSeconds ??
                      phoneCallSettings().phoneCallRingSeconds) *
                      1000,
                ),
              },
              role: "bot",
              clientNonce: { startsWith: "call:", endsWith: ":request" },
            },
            orderBy: { seq: "desc" },
            distinct: ["threadId"],
            select: { threadId: true, role: true, blocks: true },
          })
        : [];
      const callsByThread = new Map(callMessages.map((message) => [message.threadId, message]));
      const candidateRunIds = [
        ...new Set(
          bots.flatMap((bot) =>
            (bot.thread?.messages ?? []).flatMap((message) =>
              message.runId ? [message.runId] : [],
            ),
          ),
        ),
      ];
      const checkedRunIds = new Set<string>();
      const peerRunIds = new Set<string>();
      const backgroundRunIds = new Set<string>();
      const classifyRunIds = async (ids: string[]) => {
        const missing = ids.filter((id) => !checkedRunIds.has(id));
        if (missing.length === 0) return;
        const rows = await prisma.run.findMany({
          where: {
            id: { in: missing },
            trigger: { in: ["bot_message", ...BACKGROUND_RUN_TRIGGERS] },
          },
          select: { id: true, trigger: true },
        });
        for (const row of rows) {
          if (isBackgroundRunTrigger(row.trigger)) backgroundRunIds.add(row.id);
          else peerRunIds.add(row.id);
        }
        for (const id of missing) checkedRunIds.add(id);
      };
      await classifyRunIds(candidateRunIds);
      // Archived Micos have no sidebar row to show counts on.
      const signals = await rosterConversationSignals(prisma, actor.userId, options.archived ? [] :
        bots.flatMap((bot) => bot.thread ? [{ botId: bot.id, threadId: bot.thread.id, unread: bot.thread.unread }] : []));
      const listed = await Promise.all(
        bots.map(async (bot) => {
          let messages = bot.thread?.messages ?? [];
          const cached = reused.get(bot.id);
          const newest = cached ? cached.newest : newestRosterMessage(messages);
          const updatedAt = rosterUpdatedAt(newest, bot.updatedAt);
          let preview = cached?.preview ?? "";
          let pagedBack = false;
          for (let attempt = 0; !cached && attempt < 5; attempt++) {
            const windowRunIds = [
              ...new Set(messages.flatMap((message) => (message.runId ? [message.runId] : []))),
            ].filter((runId) => !checkedRunIds.has(runId));
            if (windowRunIds.length > 0) {
              await classifyRunIds(windowRunIds);
            }
            const visible = userVisibleMessages(
              messages.map((message) => ({
                ...message,
                blocks: message.blocks as MessageBlock[],
                runId: message.runId ?? undefined,
              })),
              {
                knownPeerRunIds: peerRunIds,
                backgroundRunIds,
                includeDelegatedReplyText: false,
              },
            );
            preview = previewFromBlocks(newestRosterMessage(visible)?.blocks);
            if (preview || messages.length === 0 || !bot.thread || attempt === 4) break;
            const oldest = messages[messages.length - 1];
            if (!oldest) break;
            pagedBack = true;
            messages = await prisma.message.findMany({
              where: { threadId: bot.thread.id, seq: { lt: oldest.seq }, ...NOT_QUIET_ROUTINE_RUN },
              orderBy: { seq: "desc" },
              take: SIDEBAR_PREVIEW_MESSAGE_WINDOW,
            });
            if (messages.length === 0) break;
          }
          // Only a preview found inside the fingerprinted window is reused; one that needed
          // older pages depends on messages the fingerprint does not cover.
          const fingerprint = bot.thread ? fingerprints.get(bot.thread.id) : undefined;
          if (!cached && !pagedBack && bot.thread && fingerprint)
            rememberRosterPreview(bot.thread.id, {
              fingerprint,
              preview,
              newest: newest ? { createdAt: newest.createdAt } : undefined,
            });
          const activeRun = primaryActiveRun(bot.runs);
          const mapped = mapBot(
            bot,
            preview,
            activeRun?.status ?? "idle",
            rosterRunErrorId(bot.thread?.runs[0], primaryActiveRun(bot.runs, bot.thread?.id)),
            updatedAt,
            ringingCall(
              bot.thread && callsByThread.has(bot.thread.id)
                ? [callsByThread.get(bot.thread.id)!]
                : [],
            ),
          );
          const threadId = waitingTaskThreadId(bot.id, activeRun);
          return threadId ? { ...mapped, waitingTaskThreadId: threadId } : mapped;
        }),
      );
      return listed.map((bot) => {
        const extra = signals.get(bot.id);
        return extra ? { ...bot, ...extra } : bot;
      });
    },

    listSpaceBotsForSpaces,

    async getBot(actor: Actor, botId: string, options: { includeArchived?: boolean } = {}) {
      const bot = await prisma.bot.findFirst({
        where: {
          id: botId,
          spaceId: actor.spaceId,
          userId: actor.userId,
          ...(options.includeArchived ? {} : { archivedAt: null }),
        },
        include: { thread: true, computer: true },
      });
      if (!bot) throw new IsolationError();
      return bot;
    },

    async createBot(
      actor: Actor,
      input: {
        name: string;
        title: string;
        description: string;
        instructions: string;
        notifyOnFinish: boolean;
        busyMessageMode?: string | null;
        fleetManagement?: boolean;
        color?: string;
        avatarFamily?: number;
        parentBotId?: string | null;
        computerMode?: ComputerMode;
        spawnKey?: string;
        agentEngine?: string;
        modelProvider?: string | null;
        modelId?: string | null;
        thinkingLevel?: string | null;
        disabledBuiltinTools?: string[];
        initialMessage?: {
          role: "user" | "bot" | "system";
          blocks: MessageBlock[];
          runId?: string;
        };
        /** Adds content in the creation transaction, after the bot and its MEMORY.md exist. */
        seed?: (tx: Prisma.TransactionClient, botId: string) => Promise<void>;
        isolationLevel?: Prisma.TransactionIsolationLevel;
      },
    ): Promise<Bot> {
      let agentEngine = input.agentEngine ?? "pi";
      let modelProvider = input.modelProvider ?? null;
      let modelId = input.modelId ?? null;
      let thinkingLevel = input.thinkingLevel ?? null;
      let disabledBuiltinTools = input.disabledBuiltinTools ?? [];
      if (input.parentBotId) {
        const parent = await prisma.bot.findFirst({
          where: {
            id: input.parentBotId,
            spaceId: actor.spaceId,
            userId: actor.userId,
          },
        });
        if (!parent) throw new IsolationError();
        if (!modelId) {
          modelProvider = parent.modelProvider ?? null;
          modelId = parent.modelId ?? null;
        }
        if (thinkingLevel == null) thinkingLevel = parent.thinkingLevel ?? null;
        if (input.agentEngine === undefined) agentEngine = parent.agentEngine ?? "pi";
        if (input.disabledBuiltinTools === undefined) {
          disabledBuiltinTools = parent.disabledBuiltinTools;
        }
      }
      const settings = await prisma.deploymentSettings.findUnique({ where: { id: "default" } });
      const envKind = process.env.SANDBOX_PROVIDER ?? "docker";
      const kind =
        envKind === "docker" && settings?.computerHost === "this-mac" ? "desktop" : envKind;
      const inTransaction = <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) =>
        input.isolationLevel
          ? prisma.$transaction(run, { isolationLevel: input.isolationLevel })
          : prisma.$transaction(run);
      const insertBot = () =>
        inTransaction(async (tx) => {
          await lockSpaceForContentCreation(tx, {
            spaceId: actor.spaceId,
            userId: actor.userId,
          });
          const positions = await tx.bot.aggregate({
            where: { spaceId: actor.spaceId, userId: actor.userId },
            _max: { position: true },
          });
          // Read under the creation lock so two bots made at once still differ.
          const existing = await tx.bot.findMany({
            where: { spaceId: actor.spaceId, userId: actor.userId, archivedAt: null },
            select: { id: true, color: true },
          });
          const avatar = input.color === undefined && input.avatarFamily === undefined
            ? chooseMicoAvatar(existing)
            : chooseBotAvatar(existing, input.color, { family: input.avatarFamily });
          const computerMode = input.computerMode ?? DEFAULT_COMPUTER_MODE;
          const teamComputer = computerMode === "team" ? await ensureComputerRecord(tx, {
            mode: "team",
            spaceId: actor.spaceId,
            userId: actor.userId,
            kind,
          }) : null;
          const created = await tx.bot.create({
            data: {
              id: avatar.id,
              spaceId: actor.spaceId,
              userId: actor.userId,
              name: displayName(input.name, ""),
              title: displayName(input.title, ""),
              description: input.description,
              instructions: input.instructions,
              notifyOnFinish: input.notifyOnFinish,
              ...(input.busyMessageMode !== undefined ? { busyMessageMode: input.busyMessageMode } : {}),
              fleetManagement: input.fleetManagement,
              color: avatar.color,
              position: (positions._max.position ?? -1) + 1,
              parentBotId: input.parentBotId ?? null,
              computerId: teamComputer?.id ?? null,
              spawnKey: input.spawnKey,
              agentEngine,
              modelProvider,
              modelId,
              thinkingLevel,
              disabledBuiltinTools,
            },
          });
          const thread = await tx.thread.create({
            data: {
              spaceId: actor.spaceId,
              botId: created.id,
              userId: actor.userId,
            },
          });
          if (input.initialMessage) {
            await createThreadMessageInTransaction(tx, {
              threadId: thread.id,
              ...input.initialMessage,
              markUnread: false,
            });
          }
          if (computerMode !== "team") {
            const dedicated = await ensureComputerRecord(tx, {
              mode: computerMode,
              spaceId: actor.spaceId,
              userId: actor.userId,
              botId: created.id,
              // "This PC" means the desktop host; it must never become Docker.
              kind: computerKindForMode(computerMode, computerMode === "isolated" ? envKind : kind),
            });
            await tx.bot.update({ where: { id: created.id }, data: { computerId: dedicated.id } });
          }
          await tx.browserProfile.create({
            data: {
              spaceId: actor.spaceId,
              botId: created.id,
              userId: actor.userId,
            },
          });
          await tx.memoryDocument.create({
            data: {
              spaceId: actor.spaceId,
              userId: actor.userId,
              botId: created.id,
              scope: "bot",
              path: "MEMORY.md",
              content: initialBotMemory(input.name),
            },
          });
          await input.seed?.(tx, created.id);
          return tx.bot.findFirstOrThrow({
            where: { id: created.id },
            include: { thread: true, computer: true },
          });
        });

      const findBySpawnKey = async () => {
        if (!input.spawnKey) return null;
        return prisma.bot.findUnique({
          where: {
            spaceId_spawnKey: {
              spaceId: actor.spaceId,
              spawnKey: input.spawnKey,
            },
          },
          include: { thread: true, computer: true },
        });
      };

      let bot: Awaited<ReturnType<typeof insertBot>>;
      try {
        bot = await insertBot();
      } catch (error) {
        if (!input.spawnKey || !isSpawnKeyConflict(error)) throw error;
        const existing = await findBySpawnKey();
        if (!existing || existing.userId !== actor.userId) throw error;
        if (!existing.archivedAt) {
          bot = existing;
        } else {
          // Free the key from the archived bot so empty-space onboarding
          // creates a fresh first bot (stale thread/runtime must not return).
          await prisma.bot.update({
            where: { id: existing.id },
            data: { spawnKey: null },
          });
          try {
            bot = await insertBot();
          } catch (retryError) {
            if (!isSpawnKeyConflict(retryError)) throw retryError;
            const winner = await findBySpawnKey();
            if (!winner || winner.userId !== actor.userId || winner.archivedAt) throw retryError;
            bot = winner;
          }
        }
      }
      return mapBot(bot);
    },

    async reorderBots(actor: Actor, botIds: string[]): Promise<void> {
      await prisma.$transaction(async (tx) => {
        const bots = await tx.bot.findMany({
          where: {
            spaceId: actor.spaceId,
            userId: actor.userId,
            archivedAt: null,
          },
          select: { id: true },
        });
        const existing = new Set(bots.map((bot) => bot.id));
        if (existing.size !== botIds.length || botIds.some((id) => !existing.has(id))) {
          throw new IsolationError();
        }
        // ponytail: rosters are small; switch to one SQL CASE update only if this becomes hot.
        await Promise.all(
          botIds.map((id, position) => tx.bot.update({ where: { id }, data: { position } })),
        );
      });
    },

    async setBotComputer(
      actor: Actor,
      botId: string,
      mode: ComputerMode,
      kind?: string,
    ): Promise<Bot> {
      const bot = await prisma.bot.findFirst({
        where: { id: botId, spaceId: actor.spaceId, userId: actor.userId },
        include: { computer: true },
      });
      if (!bot?.computer) throw new IsolationError();
      const targetKind = kind ?? computerKindForMode(mode, bot.computer.kind);
      // Keep ensure + bot link in one transaction so a capped quota lock covers
      // both steps (a computer row alone does not count until a live bot refs it).
      const updated = await withTransactionRetry(() =>
        prisma.$transaction(async (tx) => {
          let computer = await ensureComputerRecord(tx, {
            mode,
            spaceId: actor.spaceId,
            userId: actor.userId,
            botId,
            kind: targetKind,
          });
          // A stopped row created before "This PC" meant the desktop host still
          // points at Docker. Move it now so the next boot uses the user's PC;
          // a live row is never re-kinded under its provider reference.
          if (
            computer.kind !== targetKind &&
            !computer.providerRef &&
            computer.state === "stopped"
          ) {
            computer = await tx.computer.update({
              where: { id: computer.id },
              data: { kind: targetKind },
            });
          }
          return tx.bot.update({
            where: { id: botId },
            data: { computerId: computer.id },
            include: { thread: true, computer: true },
          });
        }),
      );
      return mapBot(updated);
    },
  };
}

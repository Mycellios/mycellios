import type { AdapterContext, ArtifactStore } from "@mycellios/adapter-kit";
import type {
  Actor,
  BranchConversationInput,
  BranchConversationOutput,
} from "@mycellios/contracts";
import {
  type BranchFileToCopy,
  ConversationBranchError,
  createConversationBranch,
  findConversationBranch,
  type PrismaClient,
  planConversationBranch,
} from "@mycellios/db";
import { getLogger } from "@mycellios/logging";
import { ORPCError } from "@orpc/server";
import { withoutPeerRunMessages } from "./thread-message-pages.js";

type BranchDeps = { prisma: PrismaClient; artifacts: ArtifactStore };

/** Files copied side by side; each one is read and written whole, so keep this small. */
const COPY_CONCURRENCY = 4;
const COPY_TIMEOUT_MS = 120_000;

function storageContext(
  actor: Actor,
  botId: string,
  requestId: string,
  signal: AbortSignal,
): AdapterContext {
  const operationId = `conversation-branch:${requestId}`;
  return {
    operationId,
    traceId: operationId,
    spaceId: actor.spaceId,
    userId: actor.userId,
    botId,
    signal,
  };
}

function missingFile(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? error.code : undefined;
  const name = "name" in error ? error.name : undefined;
  return code === "ENOENT" || code === "NoSuchKey" || name === "NotFound" || name === "NoSuchKey";
}

/** The refusal as the person reads it, with a status that says whose move it is. */
export function branchErrorToRpc(error: unknown): unknown {
  if (!(error instanceof ConversationBranchError)) return error;
  const code =
    error.code === "not_found"
      ? "NOT_FOUND"
      : error.code === "message" || error.code === "source" || error.code === "too_large"
        ? "BAD_REQUEST"
        : "CONFLICT";
  return new ORPCError(code, { message: error.message, cause: error });
}

/**
 * Branches a finished turn into a new conversation of the same Mico. The files the copied
 * messages show are copied first (new storage objects in the same Space, sealed under its
 * key), then one transaction under the source's lock copies the messages and makes the
 * branch. Copies that end up unused (a failure, or a retry that found the branch) are removed.
 */
export async function branchConversation(
  deps: BranchDeps,
  actor: Actor,
  input: BranchConversationInput,
): Promise<BranchConversationOutput> {
  const scope = { spaceId: actor.spaceId, userId: actor.userId };
  const request = {
    botId: input.botId,
    sourceThreadId: input.taskThreadId,
    messageId: input.messageId,
    visible: withoutPeerRunMessages,
  };
  const existing = await findConversationBranch(deps.prisma, scope, {
    botId: input.botId,
    requestId: input.requestId,
  });
  if (existing) return existing;
  const { files } = await planConversationBranch(deps.prisma, scope, request);
  const signal = AbortSignal.timeout(COPY_TIMEOUT_MS);
  const copies = new Map<string, { storageKey: string } | null>();
  const made: Array<{ storageKey: string; botId: string }> = [];
  const removeCopies = async () => {
    for (const copy of made) {
      await deps.artifacts
        .remove(
          copy.storageKey,
          storageContext(actor, copy.botId, input.requestId, AbortSignal.timeout(30_000)),
        )
        .catch((error) =>
          getLogger().warn("branch file copy cleanup failed", { error: String(error) }),
        );
    }
  };
  const copyOne = async (file: BranchFileToCopy) => {
    const botId = file.botId ?? input.botId;
    const context = storageContext(actor, botId, input.requestId, signal);
    let bytes: Uint8Array;
    try {
      bytes = await deps.artifacts.get(file.storageKey, context);
    } catch (error) {
      // The source already lost these bytes; the copy shows the same missing file.
      if (missingFile(error)) {
        copies.set(file.id, null);
        return;
      }
      throw error;
    }
    const stored = await deps.artifacts.put(
      { name: file.name, mimeType: file.mimeType, bytes },
      context,
    );
    made.push({ storageKey: stored.id, botId });
    copies.set(file.id, { storageKey: stored.id });
  };
  try {
    const queue = [...files];
    await Promise.all(
      Array.from({ length: Math.min(COPY_CONCURRENCY, queue.length) }, async () => {
        for (let file = queue.shift(); file; file = queue.shift()) await copyOne(file);
      }),
    );
    const result = await createConversationBranch(deps.prisma, scope, {
      ...request,
      requestId: input.requestId,
      files: copies,
    });
    if (result.replayed) await removeCopies();
    return result;
  } catch (error) {
    await removeCopies();
    throw error;
  }
}

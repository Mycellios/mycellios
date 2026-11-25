import type { ProductEvent } from "@mycellios/contracts";
import type { PrismaClient, ThreadEvents } from "@mycellios/db";
import { ORPCError } from "@orpc/server";
import { HEARTBEAT_MS, SESSION_RECHECK_MS } from "./routes/shared.js";
import {
  isBackgroundRun,
  isPeerRun,
  shouldForwardBackgroundThreadEvent,
  shouldForwardPeerThreadEvent,
} from "./thread-message-pages.js";
import type { ThreadTarget } from "./thread-target.js";

/**
 * A thread's live events from `cursor`, for threads.subscribe and a Space member's own
 * conversation (sharedMicos.subscribe). Silence is punctuated with heartbeats, and access is
 * checked again before delivering more, so a revoked session or share ends the stream.
 */
export async function* threadEventStream(
  deps: { prisma: PrismaClient; events: ThreadEvents },
  input: {
    spaceId: string;
    target: ThreadTarget;
    cursor: number;
    signal?: AbortSignal;
    /** Re-runs the request's access check; false ends the stream as unauthorized. */
    stillAuthorized?: () => Promise<boolean>;
  },
): AsyncGenerator<ProductEvent> {
  const { target, signal } = input;
  const peerRunCache = new Map<string, Promise<boolean>>();
  const backgroundRunCache = new Map<string, Promise<boolean>>();
  const follow = deps.events.follow(target.threadId, input.cursor, signal);
  // A half-open stream looks identical to an idle one, so punctuate silence:
  // the client treats any frame as liveness and reconnects once they stop.
  let pending: Promise<IteratorResult<ProductEvent>> | undefined;
  // Auth ran once when the stream opened. Re-check before delivering more, so a signed-out
  // or revoked session stops within SESSION_RECHECK_MS, or at the next heartbeat when idle.
  let authorizedAt = Date.now();
  const assertStillAuthorized = async () => {
    if (!input.stillAuthorized || Date.now() - authorizedAt < SESSION_RECHECK_MS) return;
    if (!(await input.stillAuthorized())) throw new ORPCError("UNAUTHORIZED");
    authorizedAt = Date.now();
  };
  try {
    while (!signal?.aborted) {
      pending ??= follow.next();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([
        pending,
        new Promise<"silent">((resolve) => {
          timer = setTimeout(() => resolve("silent"), HEARTBEAT_MS);
        }),
      ]).finally(() => clearTimeout(timer));
      if (next === "silent") {
        await assertStillAuthorized();
        // Keep `pending` so the in-flight read stays the next event in order.
        yield {
          id: "heartbeat",
          spaceId: input.spaceId,
          threadId: target.threadId,
          // A bot thread's id is not the bot. Groups have no single bot, so the thread id stands in.
          botId: target.kind === "bot" ? target.botId : target.threadId,
          seq: 0,
          type: "heartbeat",
          createdAt: new Date().toISOString(),
          payload: {},
        };
        continue;
      }
      pending = undefined;
      if (next.done) return;
      const event = next.value;
      // Filtered peer events also restart the heartbeat, so check before skipping them.
      await assertStillAuthorized();
      if (await isPeerRun(deps.prisma, event.runId, peerRunCache)) {
        if (!shouldForwardPeerThreadEvent(event)) continue;
      } else if (await isBackgroundRun(deps.prisma, event.runId, backgroundRunCache)) {
        if (!shouldForwardBackgroundThreadEvent(event)) continue;
      }
      yield event;
    }
  } finally {
    // Not awaited: closing can queue behind a read that the abort has not landed on yet.
    void follow.return(undefined).catch(() => {});
  }
}

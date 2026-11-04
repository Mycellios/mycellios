import { setTimeout as delay } from "node:timers/promises";
import type { Actor } from "@rakazo/contracts";
import { MessageBlock } from "@rakazo/contracts";
import { speechFromBlocks } from "@rakazo/core";
import { runAsTenant } from "@rakazo/db";
import type { Hono } from "hono";
import { resolveThreadTarget } from "../thread-target.js";
import { synthesizeVoice, transcribeVoice, type VoiceDeps } from "../voice.js";
import { speechToMuLaw } from "./audio.js";
import type { RtcMico, RtcVoiceTarget } from "./session.js";
export function currentMicoVoice(
  app: Hono,
  deps: VoiceDeps,
  actor: Actor,
  request: Request,
  target: RtcVoiceTarget,
  authenticate: (request: Request) => Promise<Actor | null>,
): RtcMico {
  // Headers remain private in this process; no session or model credential is sent to a peer.
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  const authRequest = new Request(request.url, { headers });
  const owned = () => runAsTenant(actor, () => resolveThreadTarget(deps.prisma, actor, target));
  const validate = async () => {
    const current = await authenticate(authRequest);
    if (current?.userId !== actor.userId || current?.spaceId !== actor.spaceId)
      throw new Error("Session ended.");
    await owned();
  };
  return {
    validate,
    async transcribe(audio, signal) {
      return (
        await runAsTenant(actor, () =>
          transcribeVoice(deps, actor, { audio, mimeType: "audio/wav", signal }),
        )
      ).text;
    },
    async speak(text, signal) {
      const clip = await runAsTenant(actor, () =>
        synthesizeVoice(deps, actor, { text, botId: target.botId, signal }),
      );
      return speechToMuLaw(clip.bytes, signal);
    },
    async reply(text, nonce, signal) {
      await validate();
      signal.throwIfAborted();
      const thread = await owned();
      // Atomic idle admission refuses steering or answering approval/secret cards by voice.
      // The ordinary route retains the Mico's model, credentials, memory and permissions.
      const response = await app.request(
        new Request(new URL("/rpc/threads/send", request.url), {
          method: "POST",
          headers,
          signal,
          body: JSON.stringify({
            json: { ...target, text, clientNonce: nonce, queueOnlyWhenIdle: true },
          }),
        }),
      );
      if (!response.ok) throw new Error("Open the chat to resolve the Mico's pending request.");
      const receipt = (await response.json()) as { json?: { runId?: string } };
      const runId = receipt.json?.runId;
      if (!runId)
        throw new Error("The Mico did not acknowledge the turn. Do not resend automatically.");
      while (true) {
        signal.throwIfAborted();
        await validate();
        const run = await runAsTenant(actor, () =>
          deps.prisma.run.findFirst({
            where: {
              id: runId,
              spaceId: actor.spaceId,
              userId: actor.userId,
              botId: target.botId,
              threadId: thread.threadId,
            },
            select: { status: true },
          }),
        );
        if (
          !run ||
          ["failed", "cancelled", "waiting_input", "waiting_takeover"].includes(run.status)
        ) {
          throw new Error("The Mico needs attention in the chat.");
        }
        if (run.status === "completed") {
          const messages = await runAsTenant(actor, () =>
            deps.prisma.message.findMany({
              where: { threadId: thread.threadId, runId, role: "bot", botId: target.botId },
              orderBy: { seq: "asc" },
              select: { blocks: true },
            }),
          );
          const blocks = messages.flatMap((message) => {
            const parsed = MessageBlock.array().safeParse(message.blocks);
            // Only final user-visible text: never speak tool output or approval/secret cards.
            return parsed.success ? parsed.data.filter((block) => block.kind === "text") : [];
          });
          return speechFromBlocks(blocks);
        }
        await delay(500, undefined, { signal });
      }
    },
  };
}

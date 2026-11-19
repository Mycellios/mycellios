import type {
  AdapterContext,
  GeneratedMedia,
  MediaGenerationProvider,
  MediaVideoJob,
} from "@rakazo/adapter-kit";
import { MediaGenerationError } from "@rakazo/adapter-kit";
import type { ImageAspectRatio, MessageBlock } from "@rakazo/contracts";
import { messageBlockForArtifact } from "@rakazo/core";
import type { ExternalEffect, PrismaClient } from "@rakazo/db";
import { z } from "zod";
import { imageAspectRatioOf, pngPixelSize } from "./image-generation-card.js";
import {
  mediaPromptSchema,
  mediaToolInputSchema,
  validateGeneratedMedia,
} from "./media-generation-provider.js";

const JOB_KIND = "media_generation_job";
const savedJob = z.object({
  provider: z.string(),
  jobId: z.string().optional(),
  artifactId: z.string().optional(),
  /** The chat message holding the image_generation card, once it is shown. */
  messageId: z.string().optional(),
});
type ImageGenerationBlock = Extract<MessageBlock, { kind: "image_generation" }>;
const savedRequest = z.object({
  prompt: z.string().optional(),
  aspectRatio: z.enum(["square", "portrait", "landscape"]).optional(),
});

/** A provider error worth showing on the card; generic codes stay localized in the client. */
function cardError(error: unknown): string | undefined {
  if (!(error instanceof MediaGenerationError) || error.message.startsWith("Media generation:"))
    return undefined;
  return error.message.slice(0, 500);
}
export async function generateMediaFromTool(options: {
  name: "generate_image" | "generate_video";
  args: Record<string, unknown>;
  executionId: string;
  /** Recover only persisted state; never submit a new billed generation. */
  recoverOnly?: boolean;
  provider: MediaGenerationProvider;
  prisma: PrismaClient;
  context: AdapterContext;
  run: { id: string; threadId: string; botId: string; userId: string; spaceId: string };
  attach: (
    output: GeneratedMedia,
    name: string,
    job: { id: string; result: { provider: string; jobId?: string } },
  ) => Promise<{ artifactId: string; block: MessageBlock }>;
  /** Posts the finished media, replacing the image card message when there is one. */
  publish: (
    blocks: MessageBlock[],
    jobId: string,
    artifactId: string,
    messageId?: string,
  ) => Promise<unknown>;
  /** Shows and settles the image card. Omitted where there is no chat to show it in. */
  card?: {
    start: (block: ImageGenerationBlock) => Promise<string>;
    settle: (messageId: string, block: ImageGenerationBlock, cancelled: boolean) => Promise<void>;
  };
}) {
  const { provider, prisma, context, run, args } = options;
  const video = options.name === "generate_video";
  if (!(video ? provider.capabilities.video : provider.capabilities.images))
    return { error: "Media generation is unavailable." };
  // The image card: shown once a submission is reserved, then settled exactly once here.
  let card: { messageId: string; prompt?: string; aspectRatio: ImageAspectRatio } | undefined;
  const settleCard = async (
    status: "failed" | "interrupted",
    error?: string,
    cancelled = false,
  ) => {
    const shown = card;
    card = undefined;
    if (!shown || !options.card) return;
    await options.card
      .settle(
        shown.messageId,
        {
          kind: "image_generation",
          status,
          aspectRatio: shown.aspectRatio,
          ...(shown.prompt ? { prompt: shown.prompt } : {}),
          ...(error ? { error } : {}),
        },
        cancelled,
      )
      .catch(() => undefined);
  };
  const cardFor = (reservation: ExternalEffect, messageId: string | undefined) => {
    if (video || !messageId) return undefined;
    const request = savedRequest.safeParse(reservation.request);
    return {
      messageId,
      prompt: request.success ? request.data.prompt : undefined,
      aspectRatio: (request.success && request.data.aspectRatio) || "square",
    };
  };
  try {
    if (
      args.jobId !== undefined &&
      (!video ||
        typeof args.jobId !== "string" ||
        !args.jobId ||
        args.jobId.length > 200 ||
        args.prompt !== undefined)
    ) {
      return { error: "Use a prompt to submit or jobId alone to poll a video." };
    }
    let reservation: ExternalEffect | null = null;
    let polling = false;
    if (video && typeof args.jobId === "string") {
      reservation = await prisma.externalEffect.findFirst({
        where: {
          id: args.jobId,
          kind: JOB_KIND,
          spaceId: run.spaceId,
          run: { userId: run.userId, botId: run.botId, threadId: run.threadId },
        },
      });
      if (!reservation) return { error: "Video job is unavailable." };
      const saved = savedJob.safeParse(reservation.result);
      if (!saved.success || saved.data.provider !== provider.id)
        return {
          error:
            "Video job provider changed or submission is uncertain. Do not resubmit automatically.",
        };
      if (saved.data.artifactId && reservation.status === "media_completed")
        return { status: "completed", artifactId: saved.data.artifactId };
      if (reservation.status === "media_failed") return { status: "failed" };
      if (!saved.data.jobId && !saved.data.artifactId)
        return { error: "Submission is uncertain. Do not resubmit automatically." };
    } else {
      const prior = await prisma.externalEffect.findFirst({
        where: {
          runId: run.id,
          kind: JOB_KIND,
          request: { path: ["executionId"], equals: options.executionId },
        },
      });
      if (prior) {
        const saved = savedJob.safeParse(prior.result);
        if (saved.success && saved.data.artifactId) {
          if (prior.status === "media_completed")
            return { status: "completed", artifactId: saved.data.artifactId };
          reservation = prior;
        } else {
          if (video && saved.success && saved.data.jobId)
            return {
              jobId: prior.id,
              status: prior.status === "media_failed" ? "failed" : "queued",
            };
          // The earlier attempt never finished here: its card cannot keep spinning.
          card = cardFor(prior, saved.success ? saved.data.messageId : undefined);
          await settleCard("interrupted");
          if (options.recoverOnly) return undefined;
          return {
            jobId: prior.id,
            error: "Submission already attempted. Poll a video job; do not resubmit automatically.",
          };
        }
      }
      if (!reservation) {
        if (options.recoverOnly) return undefined;
        const input = mediaToolInputSchema.safeParse(args);
        if (!input.success)
          return {
            error:
              "A prompt of 1–4000 characters is required; aspect_ratio is square, portrait or landscape.",
          };
        // A unique slot makes the per-run cap durable even across concurrent calls/restarts.
        for (let slot = 0; slot < 2; slot++) {
          try {
            reservation = await prisma.externalEffect.create({
              data: {
                spaceId: run.spaceId,
                runId: run.id,
                kind: JOB_KIND,
                idempotencyKey: `media:${run.id}:${slot}`,
                status: "media_submitting",
                request: {
                  tool: options.name,
                  prompt: input.data.prompt,
                  ...(video ? {} : { aspectRatio: input.data.aspectRatio ?? "square" }),
                  executionId: options.executionId,
                },
                result: { provider: provider.id },
              },
            });
            break;
          } catch (error) {
            if (!(error && typeof error === "object" && "code" in error && error.code === "P2002"))
              throw error;
          }
        }
        if (!reservation)
          return { error: "Media generation limit reached (two submissions per run)." };
        if (!video && options.card) {
          const messageId = await options.card.start({
            kind: "image_generation",
            status: "generating",
            aspectRatio: input.data.aspectRatio ?? "square",
            prompt: input.data.prompt,
          });
          // Remember the card with the reservation so recovery settles the same message.
          const result = { provider: provider.id, messageId };
          await prisma.externalEffect.updateMany({
            where: { id: reservation.id, result: { equals: { provider: provider.id } } },
            data: { result },
          });
          reservation = { ...reservation, result };
        }
      }
    }
    const saved = savedJob.parse(reservation.result);
    card = cardFor(reservation, saved.messageId);
    if (saved.artifactId) {
      const artifact = await prisma.artifact.findFirst({
        where: { id: saved.artifactId, spaceId: run.spaceId, userId: run.userId, botId: run.botId },
      });
      if (!artifact) {
        await settleCard("failed");
        return { error: "Generated attachment is unavailable." };
      }
      const block = messageBlockForArtifact(artifact);
      await options.publish(
        card && block.kind === "image"
          ? [{ ...completedCard(card), artifactId: artifact.id }, block]
          : [block],
        reservation.id,
        artifact.id,
        card?.messageId,
      );
      return { status: "completed", artifactId: artifact.id };
    }
    if (video && typeof args.jobId === "string") {
      const claim = await prisma.externalEffect.updateMany({
        where: {
          id: reservation.id,
          OR: [
            { status: "media_pending" },
            { status: "media_polling", updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
          ],
        },
        data: { status: "media_polling" },
      });
      if (!claim.count)
        return options.recoverOnly
          ? { jobId: reservation.id, status: "running" }
          : {
              error:
                "Video job is already being checked or needs recovery. Do not resubmit automatically.",
            };
      polling = true;
    }
    let output: MediaVideoJob | { status: "completed"; output: GeneratedMedia };
    try {
      output = video
        ? saved.jobId
          ? await provider.pollVideo(saved.jobId, context)
          : await provider.generateVideo(mediaPromptSchema.parse(args), context)
        : {
            status: "completed" as const,
            output: await provider.generateImage(mediaToolInputSchema.parse(args), context),
          };
    } catch (error) {
      if (polling)
        await prisma.externalEffect.updateMany({
          where: { id: reservation.id, status: { not: "media_completed" } },
          data: { status: "media_pending" },
        });
      throw error;
    }
    if (video && "id" in output) {
      await prisma.externalEffect.updateMany({
        where: {
          id: reservation.id,
          status: { not: "media_completed" },
          result: { equals: saved },
        },
        data: {
          status:
            output.status === "failed"
              ? "media_failed"
              : output.status === "completed"
                ? "media_polling"
                : "media_pending",
          result: { provider: provider.id, jobId: output.id },
        },
      });
    }
    if (output.status !== "completed")
      return {
        jobId: reservation.id,
        status: output.status,
        ...("progress" in output ? { progress: output.progress } : {}),
      };
    validateGeneratedMedia(output.output, video ? "video/mp4" : "image/png");
    context.signal.throwIfAborted();
    const attached = await options.attach(
      output.output,
      `generated-${reservation.id}.${video ? "mp4" : "png"}`,
      {
        id: reservation.id,
        result: {
          provider: provider.id,
          ...("id" in output ? { jobId: output.id } : {}),
          ...(saved.messageId ? { messageId: saved.messageId } : {}),
        },
      },
    );
    const size = video ? null : pngPixelSize(output.output.bytes);
    await options.publish(
      card && attached.block.kind === "image"
        ? [
            {
              ...completedCard(card),
              artifactId: attached.artifactId,
              ...(size
                ? { aspectRatio: imageAspectRatioOf(size), width: size.width, height: size.height }
                : {}),
            },
            attached.block,
          ]
        : [attached.block],
      reservation.id,
      attached.artifactId,
      card?.messageId,
    );
    card = undefined;
    return { status: "completed", artifactId: attached.artifactId };
  } catch (error) {
    if (context.signal.aborted) {
      await settleCard("interrupted", undefined, true);
      context.signal.throwIfAborted();
    }
    await settleCard("failed", cardError(error));
    return {
      error:
        error instanceof MediaGenerationError
          ? error.message
          : "Media generation failed. Submission may have been accepted; do not retry automatically.",
    };
  }
}

function completedCard(card: {
  prompt?: string;
  aspectRatio: ImageAspectRatio;
}): ImageGenerationBlock {
  return {
    kind: "image_generation",
    status: "completed",
    aspectRatio: card.aspectRatio,
    ...(card.prompt ? { prompt: card.prompt } : {}),
  };
}

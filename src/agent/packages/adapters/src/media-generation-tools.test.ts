import type { AdapterContext } from "@mycellios/adapter-kit";
import { MediaGenerationError } from "@mycellios/adapter-kit";
import { ATTACHMENT_MAX_BYTES } from "@mycellios/contracts";
import { toolRequiresApproval } from "@mycellios/core";
import type { PrismaClient } from "@mycellios/db";
import { describe, expect, it, vi } from "vitest";
import { selectBuiltinToolsForRun } from "./executor.js";
import { FakeMediaGenerationProvider } from "./media-generation-provider.js";
import { generateMediaFromTool } from "./media-generation-tools.js";

const run = { id: "run", threadId: "thread", botId: "bot", spaceId: "space", userId: "owner" };
const context: AdapterContext = {
  ...run,
  operationId: "op",
  traceId: "trace",
  signal: new AbortController().signal,
};
function setup() {
  const provider = new FakeMediaGenerationProvider();
  const row = {
    id: "local-job",
    status: "media_pending",
    result: { provider: "fake", jobId: "remote-job" },
  };
  const externalEffect = {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi
      .fn()
      .mockResolvedValue({ ...row, status: "media_submitting", result: { provider: "fake" } }),
    update: vi.fn().mockResolvedValue(row),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const attach = vi.fn().mockResolvedValue({
    artifactId: "artifact",
    block: { kind: "image", artifactId: "artifact", name: "generated.png" },
  });
  const publish = vi.fn();
  const options = {
    name: "generate_image" as const,
    args: { prompt: "draw" } as Record<string, unknown>,
    executionId: "execution",
    provider,
    prisma: {
      externalEffect,
      artifact: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient,
    context,
    run,
    attach,
    publish,
  };
  return { options, externalEffect, provider, attach, publish, row };
}

describe("bot media tools", () => {
  it("uses existing approval and per-bot disable controls, hidden by default", () => {
    for (const name of ["generate_image", "generate_video"])
      expect(toolRequiresApproval(name, false)).toBe(true);
    const base = {
      graphicalToolsAllowed: false,
      groupId: null,
      trigger: "message",
      semanticMemoryEnabled: false,
      messagingChannelRun: false,
    };
    const names = (extra = {}) =>
      selectBuiltinToolsForRun({ ...base, ...extra }).map((tool) => tool.name);
    expect(names()).not.toContain("generate_image");
    expect(names()).not.toContain("generate_video");
    expect(names({ mediaImagesEnabled: true })).toContain("generate_image");
    expect(names({ mediaImagesEnabled: true })).not.toContain("generate_video");
    expect(names({ mediaVideoEnabled: true })).toContain("generate_video");
    expect(
      names({ trigger: "tickets", mediaImagesEnabled: true, mediaVideoEnabled: true }),
    ).not.toContain("generate_image");
    expect(
      names({ trigger: "tickets", mediaImagesEnabled: true, mediaVideoEnabled: true }),
    ).not.toContain("generate_video");
    expect(
      names({ mediaVideoEnabled: true, disabledBuiltinTools: ["generate_video"] }),
    ).not.toContain("generate_video");
  });
  it("reserves before generation and posts stored attachments", async () => {
    const { options, provider, attach, publish, externalEffect } = setup();
    const generate = vi.spyOn(provider, "generateImage");
    expect(await generateMediaFromTool(options)).toEqual({
      status: "completed",
      artifactId: "artifact",
    });
    expect(externalEffect.create.mock.invocationCallOrder[0]).toBeLessThan(
      generate.mock.invocationCallOrder[0]!,
    );
    expect(attach).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "image/png" }),
      "generated-local-job.png",
      expect.objectContaining({ id: "local-job" }),
    );
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid inputs before reserving or billing", async () => {
    const { options, externalEffect } = setup();
    for (const args of [{ prompt: " " }, { prompt: "draw", jobId: "job" }, { jobId: 42 }]) {
      expect(await generateMediaFromTool({ ...options, args })).toHaveProperty("error");
    }
    expect(externalEffect.create).not.toHaveBeenCalled();
  });
  it("enforces durable two-submission limit", async () => {
    const { options, externalEffect, provider } = setup();
    externalEffect.create.mockRejectedValue({ code: "P2002" });
    const generate = vi.spyOn(provider, "generateImage");
    expect(await generateMediaFromTool(options)).toMatchObject({
      error: expect.stringContaining("limit reached"),
    });
    expect(externalEffect.create).toHaveBeenCalledTimes(2);
    expect(generate).not.toHaveBeenCalled();
  });
  it("does not rebill a replayed execution", async () => {
    const { options, externalEffect, row, provider } = setup();
    externalEffect.findFirst.mockResolvedValue(row);
    const generate = vi.spyOn(provider, "generateImage");
    expect(await generateMediaFromTool(options)).toHaveProperty("error");
    expect(generate).not.toHaveBeenCalled();
    expect(externalEffect.create).not.toHaveBeenCalled();
  });
  it("submits and persists async jobs without posting a pending result as a message", async () => {
    const { options, externalEffect, publish } = setup();
    expect(await generateMediaFromTool({ ...options, name: "generate_video" })).toMatchObject({
      status: "queued",
      jobId: "local-job",
    });
    expect(externalEffect.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "media_pending", result: { provider: "fake", jobId: "fake-video" } },
      }),
    );
    expect(publish).not.toHaveBeenCalled();
  });
  it("scopes polling to the owner, bot and thread and never accepts arbitrary provider IDs", async () => {
    const { options, externalEffect, provider } = setup();
    const poll = vi.spyOn(provider, "pollVideo");
    expect(
      await generateMediaFromTool({
        ...options,
        name: "generate_video",
        args: { jobId: "foreign" },
      }),
    ).toHaveProperty("error");
    expect(externalEffect.findFirst).toHaveBeenCalledWith({
      where: {
        id: "foreign",
        kind: "media_generation_job",
        spaceId: "space",
        run: { userId: "owner", botId: "bot", threadId: "thread" },
      },
    });
    expect(poll).not.toHaveBeenCalled();
  });
  it("resumes a saved job and posts completed video once", async () => {
    const { options, externalEffect, row, provider, publish, attach } = setup();
    externalEffect.findFirst.mockResolvedValue(row);
    const poll = vi.spyOn(provider, "pollVideo");
    expect(
      await generateMediaFromTool({ ...options, name: "generate_video", args: { jobId: row.id } }),
    ).toMatchObject({ status: "completed", artifactId: "artifact" });
    expect(poll).toHaveBeenCalledWith("remote-job", context);
    expect(attach).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "video/mp4" }),
      "generated-local-job.mp4",
      expect.objectContaining({ id: "local-job" }),
    );
    expect(publish).toHaveBeenCalledTimes(1);
    externalEffect.findFirst.mockResolvedValue({
      ...row,
      result: { provider: "fake", artifactId: "artifact" },
    });
    await generateMediaFromTool({ ...options, name: "generate_video", args: { jobId: row.id } });
    expect(poll).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it.each(["generate_image", "generate_video"] as const)(
    "recovers %s after storage succeeds and publication fails without generating again",
    async (name) => {
      const { options, externalEffect, row, provider, attach, publish } = setup();
      externalEffect.findFirst.mockResolvedValue({
        ...row,
        result: { ...row.result, artifactId: "artifact" },
      });
      const artifact = {
        id: "artifact",
        name: "generated.png",
        mimeType: "image/png",
        size: 4,
      };
      vi.mocked(options.prisma.artifact.findFirst).mockResolvedValue(artifact as never);
      const image = vi.spyOn(provider, "generateImage");
      const poll = vi.spyOn(provider, "pollVideo");
      publish.mockRejectedValueOnce(new Error("publication failed"));
      expect(
        await generateMediaFromTool({
          ...options,
          name,
          args: name === "generate_video" ? { jobId: row.id } : { prompt: "draw" },
        }),
      ).toHaveProperty("error");
      expect(
        await generateMediaFromTool({
          ...options,
          name,
          args: name === "generate_video" ? { jobId: row.id } : { prompt: "draw" },
        }),
      ).toEqual({ status: "completed", artifactId: artifact.id });
      expect(image).not.toHaveBeenCalled();
      expect(poll).not.toHaveBeenCalled();
      expect(attach).not.toHaveBeenCalled();
      expect(publish).toHaveBeenCalledWith(
        [expect.objectContaining({ artifactId: artifact.id })],
        row.id,
        artifact.id,
        undefined,
      );
    },
  );
  it("never submits or reserves new work in recovery-only mode", async () => {
    const { options, externalEffect, provider } = setup();
    const submit = vi.spyOn(provider, "generateImage");
    expect(await generateMediaFromTool({ ...options, recoverOnly: true })).toBeUndefined();
    expect(submit).not.toHaveBeenCalled();
    expect(externalEffect.create).not.toHaveBeenCalled();
  });
  it("returns the existing running job when an interrupted poll is still claimed", async () => {
    const { options, externalEffect, row, provider } = setup();
    externalEffect.findFirst.mockResolvedValue(row);
    externalEffect.updateMany.mockResolvedValue({ count: 0 });
    const poll = vi.spyOn(provider, "pollVideo");
    expect(
      await generateMediaFromTool({
        ...options,
        name: "generate_video",
        args: { jobId: row.id },
        recoverOnly: true,
      }),
    ).toEqual({ jobId: row.id, status: "running" });
    expect(poll).not.toHaveBeenCalled();
  });
  it("does not concurrently poll a claimed job", async () => {
    const { options, externalEffect, row, provider } = setup();
    externalEffect.findFirst.mockResolvedValue(row);
    externalEffect.updateMany.mockResolvedValue({ count: 0 });
    const poll = vi.spyOn(provider, "pollVideo");
    expect(
      await generateMediaFromTool({ ...options, name: "generate_video", args: { jobId: row.id } }),
    ).toHaveProperty("error");
    expect(poll).not.toHaveBeenCalled();
  });
  it("releases failed polling claims without resubmitting", async () => {
    const { options, externalEffect, row, provider } = setup();
    externalEffect.findFirst.mockResolvedValue(row);
    vi.spyOn(provider, "pollVideo").mockRejectedValue(new Error("private provider failure"));
    expect(
      await generateMediaFromTool({ ...options, name: "generate_video", args: { jobId: row.id } }),
    ).toMatchObject({ error: expect.not.stringContaining("private") });
    expect(externalEffect.updateMany).toHaveBeenCalledWith({
      where: { id: row.id, status: { not: "media_completed" } },
      data: { status: "media_pending" },
    });
  });
  it("rejects oversized or wrong-MIME adapter output before storage", async () => {
    const { options, provider, attach } = setup();
    vi.spyOn(provider, "generateImage")
      .mockResolvedValueOnce({
        bytes: new Uint8Array(ATTACHMENT_MAX_BYTES + 1),
        mimeType: "image/png",
      })
      .mockResolvedValueOnce({ bytes: new Uint8Array([1]), mimeType: "video/mp4" });
    expect(await generateMediaFromTool(options)).toHaveProperty("error");
    expect(await generateMediaFromTool(options)).toHaveProperty("error");
    expect(attach).not.toHaveBeenCalled();
  });
});

describe("image generation card", () => {
  function withCard() {
    const base = setup();
    base.externalEffect.create.mockResolvedValue({
      ...base.row,
      status: "media_submitting",
      request: { tool: "generate_image", prompt: "a fox", aspectRatio: "portrait" },
      result: { provider: "fake" },
    });
    const card = {
      start: vi.fn().mockResolvedValue("card-message"),
      settle: vi.fn().mockResolvedValue(undefined),
    };
    const options = {
      ...base.options,
      args: { prompt: "a fox", aspect_ratio: "portrait" } as Record<string, unknown>,
      card,
    };
    return { ...base, options, card };
  }

  it("shows the card before generating and finishes it in place", async () => {
    const { options, card, provider, publish, externalEffect } = withCard();
    const generate = vi.spyOn(provider, "generateImage");
    expect(await generateMediaFromTool(options)).toEqual({
      status: "completed",
      artifactId: "artifact",
    });
    expect(card.start).toHaveBeenCalledWith({
      kind: "image_generation",
      status: "generating",
      aspectRatio: "portrait",
      prompt: "a fox",
    });
    expect(card.start.mock.invocationCallOrder[0]).toBeLessThan(
      generate.mock.invocationCallOrder[0]!,
    );
    expect(generate).toHaveBeenCalledWith({ prompt: "a fox", aspectRatio: "portrait" }, context);
    expect(externalEffect.updateMany).toHaveBeenCalledWith({
      where: { id: "local-job", result: { equals: { provider: "fake" } } },
      data: { result: { provider: "fake", messageId: "card-message" } },
    });
    // The fake provider returns a 1×1 PNG: the card records the real size and shape.
    expect(publish).toHaveBeenCalledWith(
      [
        {
          kind: "image_generation",
          status: "completed",
          prompt: "a fox",
          artifactId: "artifact",
          aspectRatio: "square",
          width: 1,
          height: 1,
        },
        { kind: "image", artifactId: "artifact", name: "generated.png" },
      ],
      "local-job",
      "artifact",
      "card-message",
    );
    expect(card.settle).not.toHaveBeenCalled();
  });

  it("marks the card failed with a provider explanation", async () => {
    const { options, card, provider, publish } = withCard();
    const failure = new MediaGenerationError("authentication");
    failure.message = "Sign in to Codex on your computer.";
    vi.spyOn(provider, "generateImage").mockRejectedValue(failure);
    expect(await generateMediaFromTool(options)).toEqual({
      error: "Sign in to Codex on your computer.",
    });
    expect(card.settle).toHaveBeenCalledWith(
      "card-message",
      {
        kind: "image_generation",
        status: "failed",
        aspectRatio: "portrait",
        prompt: "a fox",
        error: "Sign in to Codex on your computer.",
      },
      false,
    );
    expect(publish).not.toHaveBeenCalled();
  });

  it("keeps generic provider codes out of the card text", async () => {
    const { options, card, provider } = withCard();
    vi.spyOn(provider, "generateImage").mockRejectedValue(
      new MediaGenerationError("provider_failure"),
    );
    await generateMediaFromTool(options);
    expect(card.settle.mock.calls[0]?.[1]).not.toHaveProperty("error");
  });

  it("marks the card interrupted when the run stops", async () => {
    const { options, card, provider } = withCard();
    const controller = new AbortController();
    vi.spyOn(provider, "generateImage").mockImplementation(async () => {
      controller.abort();
      throw new Error("aborted");
    });
    await expect(
      generateMediaFromTool({ ...options, context: { ...context, signal: controller.signal } }),
    ).rejects.toThrow();
    expect(card.settle).toHaveBeenCalledWith(
      "card-message",
      expect.objectContaining({ status: "interrupted" }),
      true,
    );
  });

  it("settles an unfinished earlier card instead of leaving it spinning", async () => {
    const { options, card, externalEffect, provider } = withCard();
    externalEffect.findFirst.mockResolvedValue({
      id: "local-job",
      status: "media_submitting",
      request: { prompt: "a fox", aspectRatio: "landscape" },
      result: { provider: "fake", messageId: "card-message" },
    });
    const generate = vi.spyOn(provider, "generateImage");
    expect(await generateMediaFromTool({ ...options, recoverOnly: true })).toBeUndefined();
    expect(card.settle).toHaveBeenCalledWith(
      "card-message",
      expect.objectContaining({ status: "interrupted", aspectRatio: "landscape" }),
      false,
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects an unknown aspect ratio before reserving", async () => {
    const { options, externalEffect, card } = withCard();
    expect(
      await generateMediaFromTool({ ...options, args: { prompt: "a fox", aspect_ratio: "wide" } }),
    ).toHaveProperty("error");
    expect(externalEffect.create).not.toHaveBeenCalled();
    expect(card.start).not.toHaveBeenCalled();
  });
});

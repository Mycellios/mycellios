import type { RealtimeFanout } from "@mycellios/adapter-kit";
import { encodeLocationAnswer } from "@mycellios/contracts";
import { LOCATION_ANSWER_MARKER } from "@mycellios/core";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { answerRunInput } from "./events.js";

const fanout: RealtimeFanout = {
  describe: () => ({
    id: "test",
    contractVersion: "1",
    adapterVersion: "1",
    capabilities: { distributed: false, push: true },
  }),
  publish: async () => undefined,
  subscribe: async () => async () => undefined,
  close: async () => undefined,
};

function harness(locationBlock: Record<string, unknown> = {}) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "thread-1" }]),
    message: {
      findFirst: vi.fn().mockResolvedValue({
        id: "message-1",
        blocks: [
          {
            kind: "ask",
            text: "Where should I look for restaurants?",
            status: "pending",
            location: locationBlock,
          },
        ],
      }),
      update: vi.fn().mockResolvedValue({ id: "message-1" }),
    },
    run: {
      findFirst: vi.fn().mockResolvedValue({ botId: "bot-1", userId: "user-1", trigger: "user" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({
        status: "queued",
        createdAt: new Date("2026-11-24T12:00:00.000Z"),
        threadId: "thread-1",
      }),
    },
    task: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    thread: { update: vi.fn().mockResolvedValue({ nextEventSeq: 7 }) },
    event: {
      create: vi.fn(async ({ data }: { data: { seq: number; type: string } }) => ({
        id: `event-${data.seq}`,
        spaceId: "workspace-1",
        threadId: "thread-1",
        botId: "bot-1",
        seq: data.seq,
        type: data.type,
        payload: {},
        runId: "run-1",
        createdAt: new Date("2026-11-24T12:00:00.000Z"),
      })),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  } as unknown as PrismaClient;
  const answer = (value: string, answeredByUserId = "user-1") =>
    answerRunInput(
      prisma,
      {
        spaceId: "workspace-1",
        threadId: "thread-1",
        runId: "run-1",
        messageId: "message-1",
        answeredByUserId,
        answer: value,
      },
      fanout,
    );
  const savedBlock = () => tx.message.update.mock.calls[0]?.[0].data.blocks[0];
  const resumedPrompt = () => tx.task.updateMany.mock.calls[0]?.[0].data.prompt as string;
  return { tx, answer, savedBlock, resumedPrompt };
}

describe("answering a location request", () => {
  it("gives the turn a rounded position and keeps only the outcome on the card", async () => {
    const { answer, savedBlock, resumedPrompt } = harness();
    // A client that skipped rounding is rounded again on the server.
    const raw = JSON.stringify({
      kind: "position",
      latitude: 40.416775,
      longitude: -3.70379,
      accuracyMeters: 12,
    });

    await expect(answer(raw)).resolves.toBe(true);

    expect(resumedPrompt()).toContain(LOCATION_ANSWER_MARKER);
    expect(resumedPrompt()).toContain("latitude 40.417, longitude -3.704 (within about 100 m)");
    expect(resumedPrompt()).not.toContain("40.4167");
    expect(savedBlock()).toEqual({
      kind: "ask",
      text: "Where should I look for restaurants?",
      status: "answered",
      answer: "",
      location: { outcome: "shared" },
    });
    expect(JSON.stringify(savedBlock())).not.toContain("40.4");
  });

  it("passes a typed place to the turn without writing it on the card", async () => {
    const { answer, savedBlock, resumedPrompt } = harness();

    await expect(
      answer(encodeLocationAnswer({ kind: "place", place: "Gran Via, Madrid" })),
    ).resolves.toBe(true);

    expect(resumedPrompt()).toContain('"Gran Via, Madrid"');
    expect(savedBlock()).toMatchObject({ answer: "", location: { outcome: "typed" } });
    expect(JSON.stringify(savedBlock())).not.toContain("Gran Via");
  });

  it("treats plain text from an older client or the composer as a typed place", async () => {
    const { answer, savedBlock, resumedPrompt } = harness();

    await expect(answer("Plaza Mayor")).resolves.toBe(true);

    expect(resumedPrompt()).toContain('"Plaza Mayor"');
    expect(savedBlock()).toMatchObject({ location: { outcome: "typed" } });
  });

  it("tells the turn the person declined and shares nothing", async () => {
    const { answer, savedBlock, resumedPrompt } = harness();

    await expect(answer(encodeLocationAnswer({ kind: "declined" }))).resolves.toBe(true);

    expect(resumedPrompt()).not.toContain(LOCATION_ANSWER_MARKER);
    expect(resumedPrompt()).toContain("chose not to share");
    expect(savedBlock()).toMatchObject({ answer: "", location: { outcome: "declined" } });
  });

  it("refuses another member's answer and malformed answers without resuming the run", async () => {
    for (const [value, user] of [
      [encodeLocationAnswer({ kind: "place", place: "Madrid" }), "user-2"],
      ['{"kind":"position","latitude":200,"longitude":0}', "user-1"],
      ["   ", "user-1"],
    ] as const) {
      const { tx, answer } = harness();
      await expect(answer(value, user)).resolves.toBe(false);
      expect(tx.run.updateMany).not.toHaveBeenCalled();
      expect(tx.task.updateMany).not.toHaveBeenCalled();
    }
  });
});

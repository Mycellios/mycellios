import type { RealtimeFanout } from "@mycellios/adapter-kit";
import { encodeLocationAnswer } from "@mycellios/contracts";
import { LOCATION_ANSWER_NOTE, LOCATION_DECLINED_PROMPT } from "@mycellios/core";
import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "./client.js";
import type { RunSecretWriter } from "./events.js";
import {
  answerRunInput,
  answerWaitingRunWithTextInTransaction,
  retireWaitingQuestionInTransaction,
} from "./events.js";

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

const card = {
  id: "message-1",
  blocks: [
    { kind: "ask", text: "Where should I look for restaurants?", status: "pending", location: {} },
  ],
};

function harness() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "thread-1" }]),
    message: {
      findFirst: vi.fn().mockResolvedValue(card),
      findMany: vi.fn().mockResolvedValue([card]),
      update: vi.fn().mockResolvedValue({ id: "message-1" }),
    },
    run: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ botId: "bot-1", userId: "user-1", trigger: "user", taskId: "task-1" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({
        status: "queued",
        createdAt: new Date("2026-11-24T12:00:00.000Z"),
        threadId: "thread-1",
      }),
    },
    task: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    thread: { update: vi.fn().mockResolvedValue({ nextEventSeq: 7 }) },
    externalEffect: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    secret: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    attempt: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
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
  const stored: Array<Parameters<RunSecretWriter["store"]>[0]> = [];
  const writer: RunSecretWriter = {
    store: async (input) => {
      stored.push(input);
    },
  };
  const answer = (value: string, answeredByUserId = "user-1", withWriter = true) =>
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
      withWriter ? writer : undefined,
    );
  const savedBlock = () => tx.message.update.mock.calls[0]?.[0].data.blocks[0];
  const resumedPrompt = () => tx.task.updateMany.mock.calls[0]?.[0].data.prompt as string;
  const asTx = tx as unknown as Prisma.TransactionClient;
  return { tx, asTx, stored, answer, savedBlock, resumedPrompt };
}

describe("answering a location request", () => {
  it("keeps a rounded position out of the task and the card, waiting encrypted with the run", async () => {
    const { tx, stored, answer, savedBlock, resumedPrompt } = harness();
    // A client that skipped rounding is rounded again on the server.
    const raw = JSON.stringify({
      kind: "position",
      latitude: 40.416775,
      longitude: -3.70379,
      accuracyMeters: 12,
    });

    await expect(answer(raw)).resolves.toBe(true);

    expect(stored).toEqual([
      expect.objectContaining({
        runId: "run-1",
        userId: "user-1",
        spaceId: "workspace-1",
        location: true,
        plaintext: encodeLocationAnswer({
          kind: "position",
          latitude: 40.417,
          longitude: -3.704,
          accuracyMeters: 100,
        }),
      }),
    ]);
    expect(resumedPrompt()).toBe(LOCATION_ANSWER_NOTE);
    expect(savedBlock()).toEqual({
      kind: "ask",
      text: "Where should I look for restaurants?",
      status: "answered",
      answer: "",
      location: { outcome: "shared" },
    });
    const written = JSON.stringify([
      tx.task.updateMany.mock.calls,
      tx.message.update.mock.calls,
      tx.event.create.mock.calls,
    ]);
    expect(written).not.toContain("40.41");
  });

  it("handles a typed place, or plain text from an older client, the same way", async () => {
    for (const value of [
      encodeLocationAnswer({ kind: "place", place: "Gran Via, Madrid" }),
      "Gran Via, Madrid",
    ]) {
      const { tx, stored, answer, savedBlock, resumedPrompt } = harness();
      await expect(answer(value)).resolves.toBe(true);
      expect(stored[0]?.plaintext).toBe(
        encodeLocationAnswer({ kind: "place", place: "Gran Via, Madrid" }),
      );
      expect(resumedPrompt()).toBe(LOCATION_ANSWER_NOTE);
      expect(savedBlock()).toMatchObject({ answer: "", location: { outcome: "typed" } });
      expect(
        JSON.stringify([tx.task.updateMany.mock.calls, tx.message.update.mock.calls]),
      ).not.toContain("Gran Via");
    }
  });

  it("tells the turn about a refusal without storing anything", async () => {
    const { stored, answer, savedBlock, resumedPrompt } = harness();
    await expect(answer(encodeLocationAnswer({ kind: "declined" }), "user-1", false)).resolves.toBe(
      true,
    );
    expect(stored).toEqual([]);
    expect(resumedPrompt()).toBe(LOCATION_DECLINED_PROMPT);
    expect(savedBlock()).toMatchObject({ answer: "", location: { outcome: "declined" } });
  });

  it("refuses another member, malformed answers and a server without encrypted storage", async () => {
    const place = encodeLocationAnswer({ kind: "place", place: "Madrid" });
    for (const [value, user, withWriter] of [
      [place, "user-2", true],
      ['{"kind":"position","latitude":200,"longitude":0}', "user-1", true],
      ["   ", "user-1", true],
      [place, "user-1", false],
    ] as const) {
      const { tx, stored, answer } = harness();
      await expect(answer(value, user, withWriter)).resolves.toBe(false);
      expect(stored).toEqual([]);
      expect(tx.run.updateMany).not.toHaveBeenCalled();
      expect(tx.task.updateMany).not.toHaveBeenCalled();
    }
  });

  it("leaves a composer message to retire the card, which keeps no text and no outcome", async () => {
    const { tx, asTx } = harness();
    const input = { spaceId: "workspace-1", threadId: "thread-1", runId: "run-1", botId: "bot-1" };

    await expect(
      answerWaitingRunWithTextInTransaction(asTx, {
        ...input,
        answeredByUserId: "user-1",
        answer: "Gran Via, Madrid",
      }),
    ).resolves.toBeNull();
    expect(tx.task.updateMany).not.toHaveBeenCalled();

    // Retiring cancels the run before it records the card and the cancellation.
    tx.run.findUnique.mockResolvedValue({
      status: "cancelled",
      createdAt: new Date("2026-11-24T12:00:00.000Z"),
      threadId: "thread-1",
    });
    await expect(
      retireWaitingQuestionInTransaction(asTx, { ...input, answer: "Gran Via, Madrid" }),
    ).resolves.toBe(true);
    const retired = tx.message.update.mock.calls[0]?.[0].data.blocks[0];
    expect(retired).toEqual({ ...card.blocks[0], status: "answered", answer: "" });
    expect(tx.secret.deleteMany).toHaveBeenCalled();
  });
});

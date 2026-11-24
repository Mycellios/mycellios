import { encodeLocationAnswer } from "@mycellios/contracts";
import type { Prisma, PrismaClient, RunSecretWriter } from "@mycellios/db";
import { describe, expect, it } from "vitest";
import { createRunSecretWriter, loadRunLocation } from "./run-secret.js";
import { EncryptedSecretStore } from "./secrets.js";

type SecretRow = { id: string; userId: string; spaceId: string; kind: string; ciphertext: string };

function harness() {
  const rows: SecretRow[] = [];
  const matches = (row: SecretRow, where: Partial<SecretRow>) =>
    Object.entries(where).every(([key, value]) => row[key as keyof SecretRow] === value);
  const secret = {
    count: async ({ where }: { where: Partial<SecretRow> }) =>
      rows.filter((row) => matches(row, where)).length,
    findFirst: async ({ where }: { where: Partial<SecretRow> }) =>
      rows.filter((row) => matches(row, where)).at(-1) ?? null,
    deleteMany: async ({ where }: { where: Partial<SecretRow> }) => {
      const removed = rows.filter((row) => matches(row, where));
      for (const row of removed) rows.splice(rows.indexOf(row), 1);
      return { count: removed.length };
    },
    create: async ({ data }: { data: SecretRow }) => {
      rows.push(data);
      return data;
    },
  };
  const prisma = {
    run: { findFirst: async () => ({ botId: "bot", userId: "owner" }) },
    message: {
      findFirst: async () => ({
        blocks: [{ kind: "ask", text: "Where should I look?", status: "pending", location: {} }],
      }),
    },
    secret,
    botSecret: { count: async () => 0 },
    integrationProviderConfig: { count: async () => 0 },
  } as unknown as PrismaClient;
  const tx = { secret } as unknown as Prisma.TransactionClient;
  const store = new EncryptedSecretStore("fake-key");
  const writer = createRunSecretWriter(store);
  const answer = (value: string, answeredByUserId = "owner") => ({
    spaceId: "space",
    threadId: "thread",
    runId: "run",
    messageId: "message",
    answeredByUserId,
    answer: value,
  });
  const save = (prepared: RunSecretWriter, plaintext: string) =>
    prepared.store({
      botId: "bot",
      runId: "run",
      userId: "owner",
      spaceId: "space",
      plaintext,
      location: true,
      tx,
    });
  return { rows, prisma, store, writer, answer, save };
}

describe("location answers waiting with the run", () => {
  it("keeps a position encrypted under the run until the executor reads it", async () => {
    const { rows, prisma, store, writer, answer, save } = harness();
    const raw = JSON.stringify({ kind: "position", latitude: 40.416775, longitude: -3.70379 });
    const plaintext = encodeLocationAnswer({
      kind: "position",
      latitude: 40.416775,
      longitude: -3.70379,
    });

    await writer.withPrepared!(prisma, answer(raw), (prepared) => save(prepared, plaintext));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: "owner", spaceId: "space", kind: "run-location:run" });
    expect(rows[0]!.ciphertext).not.toContain("40.4");
    await expect(
      loadRunLocation(prisma, store, { id: "run", userId: "owner", spaceId: "space" }),
    ).resolves.toEqual({
      kind: "position",
      latitude: 40.417,
      longitude: -3.704,
      accuracyMeters: 100,
    });
  });

  it("replaces an earlier answer of the same run", async () => {
    const { rows, prisma, store, writer, answer, save } = harness();
    for (const place of ["Old Town", "Gran Via, Madrid"]) {
      const value = encodeLocationAnswer({ kind: "place", place });
      await writer.withPrepared!(prisma, answer(value), (prepared) => save(prepared, value));
    }
    expect(rows).toHaveLength(1);
    await expect(
      loadRunLocation(prisma, store, { id: "run", userId: "owner", spaceId: "space" }),
    ).resolves.toEqual({ kind: "place", place: "Gran Via, Madrid" });
  });

  it("stores nothing for a refusal, another member or a changed answer", async () => {
    const { rows, prisma, writer, answer, save } = harness();
    const place = encodeLocationAnswer({ kind: "place", place: "Lisbon" });
    for (const [input, plaintext] of [
      [answer(encodeLocationAnswer({ kind: "declined" })), place],
      [answer(place, "member"), place],
      [answer(place), encodeLocationAnswer({ kind: "place", place: "Porto" })],
    ] as const) {
      await expect(
        writer.withPrepared!(prisma, input, (prepared) => save(prepared, plaintext)),
      ).rejects.toThrow(/changed; retry/);
    }
    expect(rows).toHaveLength(0);
  });
});

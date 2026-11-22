import { describe, expect, it } from "vitest";
import type { PrismaClient } from "./generated/prisma/client.js";
import {
  assertDatabaseSchemaCurrent,
  clientSchema,
  missingDatabaseSchema,
} from "./schema-compatibility.js";

const models = {
  ChatGroup: {
    dbName: "chat_groups",
    fields: [
      { name: "id", kind: "scalar" },
      { name: "purpose", kind: "scalar" },
      { name: "space", kind: "object" },
      { name: "leadBotId", kind: "scalar" },
      { name: "createdAt", kind: "scalar", dbName: "created_at" },
    ],
  },
  BotMessageRequest: {
    dbName: "bot_message_requests",
    fields: [{ name: "id", kind: "scalar" }],
  },
};

/** A client whose live database has exactly these columns. */
function client(columns: Array<[string, string]>, dataModel: unknown = { models }) {
  const queries: unknown[][] = [];
  const prisma = {
    _runtimeDataModel: dataModel,
    $queryRawUnsafe: async (...args: unknown[]) => {
      queries.push(args);
      return columns.map(([table, column]) => ({ table, column }));
    },
  } as unknown as PrismaClient;
  return { prisma, queries };
}

const current: Array<[string, string]> = [
  ["chat_groups", "id"],
  ["chat_groups", "purpose"],
  ["chat_groups", "leadBotId"],
  ["chat_groups", "created_at"],
  ["chat_groups", "added_by_a_later_release"],
  ["bot_message_requests", "id"],
  ["other_table", "id"],
];

describe("clientSchema", () => {
  it("lists each model's table and mapped scalar columns, not its relations", () => {
    expect(clientSchema(client([]).prisma)).toEqual(
      new Map([
        ["chat_groups", ["id", "purpose", "leadBotId", "created_at"]],
        ["bot_message_requests", ["id"]],
      ]),
    );
  });

  it("refuses a client without a runtime data model", () => {
    expect(() => clientSchema(client([], null).prisma)).toThrow("runtime data model");
  });
});

describe("missingDatabaseSchema", () => {
  it("accepts a database that also has newer tables and columns", async () => {
    const { prisma, queries } = client(current);
    await expect(missingDatabaseSchema(prisma)).resolves.toEqual([]);
    expect(queries[0]?.[1]).toBe("public");
  });

  it("names the missing tables and columns", async () => {
    const behind = current.filter(
      ([table, column]) => table !== "bot_message_requests" && column !== "purpose",
    );
    await expect(missingDatabaseSchema(client(behind).prisma)).resolves.toEqual([
      "bot_message_requests",
      "chat_groups.purpose",
    ]);
  });
});

describe("assertDatabaseSchemaCurrent", () => {
  it("lets a current database start", async () => {
    await expect(assertDatabaseSchemaCurrent(client(current).prisma)).resolves.toBeUndefined();
  });

  it("stops startup and says how to apply the migrations", async () => {
    const behind = current.filter(([, column]) => column !== "purpose");
    await expect(assertDatabaseSchemaCurrent(client(behind).prisma)).rejects.toThrow(
      /behind this build \(missing chat_groups\.purpose\).*npm run db:deploy/,
    );
  });

  it("bounds the list of missing objects", async () => {
    const many = {
      models: Object.fromEntries(
        Array.from({ length: 25 }, (_, i) => [`M${i}`, { dbName: `t${i}`, fields: [] }]),
      ),
    };
    await expect(assertDatabaseSchemaCurrent(client([], many).prisma)).rejects.toThrow(
      "and 5 more)",
    );
  });
});

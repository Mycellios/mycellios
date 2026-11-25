import type { Actor, SpaceRole } from "@mycellios/contracts";
import type { PrismaClient } from "@mycellios/db";
import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";
import { assertSpaceRoleAllows, sharedSpaceProcedure } from "./routes/context.js";
import { spaceInvitationUrl } from "./routes/space-members.js";

const actor = {
  userId: "user-member",
  spaceId: "space-shared",
  email: "member@example.test",
  isDeploymentOwner: false,
} satisfies Actor;

/** A database any query of which fails the test: refused calls must never reach it. */
function untouchable(): PrismaClient {
  const fail = (path: string): unknown =>
    new Proxy(() => undefined, {
      get: (_target, key) => fail(`${path}.${String(key)}`),
      apply: () => {
        throw new Error(`database touched: ${path}`);
      },
    });
  return fail("prisma") as PrismaClient;
}

function client(options: { spaceRole?: SpaceRole; spaceMembers?: { limit: number } }) {
  const deps = {
    prisma: untouchable(),
    env: {
      defaultProvider: "fake",
      defaultModel: "fake-model",
      webOrigin: "http://127.0.0.1:5173",
      screenProxySecret: "fake-test-secret",
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      spaceMembers: options.spaceMembers,
    },
    dataDir: "/tmp/space-members-test",
  } as unknown as RouterDeps;
  return createRouterClient(createRouter(deps), {
    context: { actor, spaceRole: options.spaceRole },
  });
}

async function code(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => "resolved",
    (error: { code?: unknown }) => error.code,
  );
}

describe("people in a Space someone else owns (specs/space-members)", () => {
  it("lets them reach only the Space's people and invitations", () => {
    expect(sharedSpaceProcedure(["spaces", "members", "list"])).toBe(true);
    expect(sharedSpaceProcedure(["spaces", "invites", "accept"])).toBe(true);
    for (const path of [
      ["spaces", "list"],
      ["spaces", "create"],
      ["bootstrap"],
      ["bots", "list"],
      ["me"],
    ])
      expect(sharedSpaceProcedure(path)).toBe(false);
    for (const role of [undefined, "owner"] as const)
      expect(() => assertSpaceRoleAllows(role, ["bots", "list"])).not.toThrow();
    for (const role of ["admin", "member"] as const) {
      expect(() => assertSpaceRoleAllows(role, ["spaces", "members", "list"])).not.toThrow();
      expect(() => assertSpaceRoleAllows(role, ["threads", "send"])).toThrow(
        "Not available in a space someone else owns.",
      );
    }
  });

  it("refuses every other procedure before it reads the database", async () => {
    for (const spaceRole of ["admin", "member"] as const) {
      const rpc = client({ spaceRole, spaceMembers: { limit: 20 } });
      expect(await code(rpc.bots.list())).toBe("FORBIDDEN");
      expect(await code(rpc.bootstrap({}))).toBe("FORBIDDEN");
      expect(await code(rpc.me())).toBe("FORBIDDEN");
      expect(await code(rpc.models.credentials())).toBe("FORBIDDEN");
      expect(await code(rpc.spaces.create({ name: "Inside" }))).toBe("FORBIDDEN");
      expect(await code(rpc.billing.status())).toBe("FORBIDDEN");
    }
  });

  it("answers NOT_FOUND for every membership procedure while the deployment keeps it off", async () => {
    for (const spaceRole of [undefined, "member"] as const) {
      const rpc = client({ spaceRole });
      expect(await code(rpc.spaces.members.list())).toBe("NOT_FOUND");
      expect(await code(rpc.spaces.members.leave())).toBe("NOT_FOUND");
      expect(await code(rpc.spaces.invites.create({ kind: "link" }))).toBe("NOT_FOUND");
      expect(
        await code(
          rpc.spaces.invites.accept({ token: "fake_token_0123456789abcdefghijklmnopqrstuv" }),
        ),
      ).toBe("NOT_FOUND");
    }
  });

  it("puts the invitation token in the link's fragment, under the app's namespace", () => {
    const token = "fake_token_0123456789abcdefghijklmnopqrstuv";
    expect(spaceInvitationUrl("https://www.example.test/agent", token)).toBe(
      `https://www.example.test/agent/join#${token}`,
    );
    expect(spaceInvitationUrl("http://127.0.0.1:5173", token)).toBe(
      `http://127.0.0.1:5173/join#${token}`,
    );
  });
});

describe("Space member procedures for the owner", () => {
  it("reach their handlers only while enabled", async () => {
    const enabled = client({ spaceRole: "owner", spaceMembers: { limit: 20 } });
    // The handler runs and reads the database, which this fixture forbids.
    await expect(enabled.spaces.members.list()).rejects.toThrow("database touched");
  });
});

describe("Micos shared with people in a Space (specs/space-members, phase 1b)", () => {
  const target = { botId: "bot-shared", taskThreadId: "thread-member" };

  it("lets members reach their shared Micos and admins the shares, and nothing else", () => {
    for (const path of [
      ["sharedMicos", "list"],
      ["sharedMicos", "send"],
      ["sharedMicos", "subscribe"],
      ["spaces", "shares", "set"],
    ])
      expect(sharedSpaceProcedure(path)).toBe(true);
    for (const path of [
      ["threads", "get"],
      ["threads", "send"],
      ["artifacts", "get"],
      ["development", "list"],
      ["spaces", "rename"],
    ])
      expect(sharedSpaceProcedure(path)).toBe(false);
  });

  it("answers NOT_FOUND while the deployment keeps Space members off, before any read", async () => {
    for (const spaceRole of [undefined, "owner", "member"] as const) {
      const rpc = client({ spaceRole });
      expect(await code(rpc.sharedMicos.list())).toBe("NOT_FOUND");
      expect(await code(rpc.sharedMicos.get(target))).toBe("NOT_FOUND");
      expect(await code(rpc.sharedMicos.send({ ...target, text: "Hello" }))).toBe("NOT_FOUND");
      expect(await code(rpc.spaces.shares.list())).toBe("NOT_FOUND");
    }
  });

  it("is not the owner's way into their own Micos", async () => {
    for (const spaceRole of [undefined, "owner"] as const) {
      const rpc = client({ spaceRole, spaceMembers: { limit: 20 } });
      expect(await code(rpc.sharedMicos.list())).toBe("NOT_FOUND");
      expect(await code(rpc.sharedMicos.stop(target))).toBe("NOT_FOUND");
    }
  });

  it("resolves the member's access before anything else on every call", async () => {
    const rpc = client({ spaceRole: "member", spaceMembers: { limit: 20 } });
    // The share is read first, from the database this fixture forbids.
    await expect(rpc.sharedMicos.get(target)).rejects.toThrow("database touched");
    await expect(rpc.spaces.shares.list()).rejects.toThrow("database touched");
  });

});

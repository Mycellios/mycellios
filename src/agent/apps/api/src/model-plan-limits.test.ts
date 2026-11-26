import { expect, it, vi } from "vitest";
import { createModelPlanLimits, type PlanLimitsCredentialRenewal } from "./model-plan-limits.js";
import type { RouterDeps } from "./router.js";

function fixture(renew?: PlanLimitsCredentialRenewal) {
  let clock = Date.now();
  let ciphertext = "version-1";
  const rows = [{ id: "owned", provider: "openai-codex", label: "Work", secretId: "secret" }];
  const secret = {
    kind: "oauth",
    credential: {
      type: "oauth",
      access: "bearer",
      refresh: "refresh",
      expires: clock + 3600_000,
      accountId: "exact-account",
    },
  };
  const credentials = vi.fn(async () => rows);
  const secrets = vi.fn(async () => [{ id: "secret", ciphertext }]);
  const load = vi.fn(async () => JSON.stringify(secret));
  const transport = vi.fn(async () =>
    Response.json({
      rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 18000 } },
    }),
  );
  const deps = {
    prisma: { userModelCredential: { findMany: credentials }, secret: { findMany: secrets } },
    secrets: { load },
    modelConnectionFetch: transport,
  } as unknown as Pick<RouterDeps, "prisma" | "secrets" | "modelConnectionFetch">;
  const readScoped = createModelPlanLimits(deps, () => clock, renew);
  return {
    read: (userId: string, refresh?: boolean) =>
      readScoped({ userId, spaceId: `${userId}-space` }, refresh),
    now: () => clock,
    rows,
    secret,
    credentials,
    secrets,
    load,
    transport,
    advance: (ms: number) => {
      clock += ms;
    },
    rotate: () => {
      ciphertext = "version-2";
    },
  };
}
it("scopes credential and secret reads to the member, coalesces requests, and invalidates rotated ciphertext", async () => {
  const f = fixture();
  const reports = await Promise.all([f.read("member"), f.read("member")]);
  expect(reports[0]?.accounts[0]).toMatchObject({
    credentialId: "owned",
    authKind: "oauth",
    status: "available",
    windows: [{ usedPercent: 25 }],
  });
  expect(f.credentials).toHaveBeenCalledWith(
    expect.objectContaining({ where: { userId: "member" } }),
  );
  expect(f.secrets).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: { in: ["secret"] }, userId: "member", spaceId: null } }),
  );
  expect(f.transport).toHaveBeenCalledTimes(1);
  await f.read("member", true);
  expect(f.transport).toHaveBeenCalledTimes(1);
  f.advance(16_000);
  await f.read("member", true);
  expect(f.transport).toHaveBeenCalledTimes(2);
  f.rotate();
  await f.read("member");
  expect(f.transport).toHaveBeenCalledTimes(3);
  f.rows.length = 0;
  expect((await f.read("member")).accounts).toEqual([]);
});
it("never uses expired tokens or API keys for subscription quota, and never reads missing secrets", async () => {
  const f = fixture();
  f.secret.credential.expires = 0;
  expect((await f.read("member")).accounts[0]?.status).toBe("reconnect");
  expect(f.transport).not.toHaveBeenCalled();
  const g = fixture();
  g.load.mockResolvedValue(JSON.stringify({ kind: "api_key", key: "key" }));
  expect((await g.read("member")).accounts[0]?.status).toBe("unsupported");
  expect(g.transport).not.toHaveBeenCalled();
  const h = fixture();
  h.secrets.mockResolvedValue([]);
  expect((await h.read("member")).accounts[0]?.reason).toBe("secret_unavailable");
  expect(h.load).not.toHaveBeenCalled();
});
it("renews an expired subscription token through the scoped refresh and reads the fresh token", async () => {
  const renew = vi.fn<PlanLimitsCredentialRenewal>(async () => {
    f.secret.credential.access = "renewed";
    f.secret.credential.expires = f.now() + 3600_000;
  });
  const f = fixture(renew);
  f.rows[0]!.provider = "anthropic";
  f.secret.credential.expires = 0;
  f.transport.mockImplementation(async () =>
    Response.json({ five_hour: { utilization: 10, resets_at: null } }),
  );
  const account = (await f.read("member")).accounts[0];
  expect(renew).toHaveBeenCalledWith(
    { userId: "member", spaceId: "member-space" },
    "secret",
    "anthropic",
  );
  expect(account?.status).not.toBe("reconnect");
  expect(f.transport).toHaveBeenCalledTimes(1);
  expect(f.transport.mock.calls[0]?.[1]).toMatchObject({
    headers: expect.objectContaining({ authorization: "Bearer renewed" }),
  });
  // The fresh token is read again under the member's own scope.
  expect(f.secrets).toHaveBeenLastCalledWith(
    expect.objectContaining({ where: { id: { in: ["secret"] }, userId: "member", spaceId: null } }),
  );
});
it("asks to reconnect when a renewal fails or no refresh token is stored", async () => {
  const failing = fixture(async () => {
    throw new Error("refused");
  });
  failing.secret.credential.expires = 0;
  expect((await failing.read("member")).accounts[0]?.status).toBe("reconnect");
  expect(failing.transport).not.toHaveBeenCalled();
  const renew = vi.fn<PlanLimitsCredentialRenewal>(async () => undefined);
  const missing = fixture(renew);
  missing.secret.credential.expires = 0;
  missing.secret.credential.refresh = "";
  expect((await missing.read("member")).accounts[0]?.status).toBe("reconnect");
  expect(renew).not.toHaveBeenCalled();
  expect(missing.transport).not.toHaveBeenCalled();
});
it("keeps account and user caches independent and respects provider Retry-After on manual refresh", async () => {
  const f = fixture();
  f.transport.mockImplementation(
    async () => new Response("private error", { status: 429, headers: { "retry-after": "300" } }),
  );
  expect((await f.read("one")).accounts[0]?.status).toBe("rate_limited");
  f.advance(61_000);
  await f.read("one", true);
  expect(f.transport).toHaveBeenCalledTimes(1);
  await f.read("two");
  expect(f.transport).toHaveBeenCalledTimes(2);
  f.advance(300_000);
  await f.read("one", true);
  expect(f.transport).toHaveBeenCalledTimes(3);
});

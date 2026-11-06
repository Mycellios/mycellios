import { expect, it, vi } from "vitest";
import { createModelPlanLimits } from "./model-plan-limits.js";
import type { RouterDeps } from "./router.js";

function fixture() {
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
  const read = createModelPlanLimits(deps, () => clock);
  return {
    read,
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

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";

// Closed-beta invitation link on isolated PostgreSQL: the actual migration, real Better Auth
// email signups racing for the places, and the bootstrap that follows an admitted one.
process.env.RAKAZO_PROJECT_LOCAL = "1";
process.env.CONTENT_ENCRYPTION = "off";
const { createDb, asSystem, SIGNUP_INVITE_COOKIE, signupInviteId } = await import("@mycellios/db");
const { createAuth } = await import("@mycellios/auth");

const socket = createServer();
await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as { port: number }).port;
await new Promise<void>((resolve) => socket.close(() => resolve()));
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-signup-invite-"));
const password = randomBytes(24).toString("hex");
const postgres = new EmbeddedPostgres({
  databaseDir: path.join(directory, "pg"),
  port,
  user: "postgres",
  password,
  persistent: true,
  createPostgresUser: false,
  autoRehydrateSymlinks: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: () => {},
});
let db: ReturnType<typeof createDb> | undefined;
try {
  await postgres.initialise();
  await postgres.start();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await promisify(execFile)(
    process.execPath,
    [path.resolve("node_modules/prisma/build/index.js"), "db", "push", "--config", "packages/db/prisma.config.ts"],
    { windowsHide: true, env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url }, maxBuffer: 1024 * 1024 },
  );
  db = createDb(url, { encryptContent: false, applicationName: "synthetic-signup-invite" });
  const prisma = db.prisma;
  const system = asSystem(prisma, "synthetic signup invite checks");

  // Recreate the table from the real migration instead of the schema push.
  const sql = await db.pool.connect();
  try {
    await sql.query("DROP TABLE signup_invite_redemptions");
    await sql.query(
      await readFile("packages/db/prisma/migrations/20261122233000_signup_invite_redemptions/migration.sql", "utf8"),
    );
    await assert.rejects(
      sql.query(`INSERT INTO signup_invite_redemptions ("userId","inviteId") VALUES ('x','not-a-hash')`),
    );
    const rls = await sql.query(
      "SELECT relrowsecurity FROM pg_class WHERE relname = 'signup_invite_redemptions'",
    );
    assert.equal(rls.rows[0].relrowsecurity, false);
  } finally {
    sql.release();
  }

  const origin = "https://app.example.test";
  const authFor = (code: string, limit: number) =>
    createAuth(prisma, {
      secret: "synthetic-auth-secret-at-least-32-characters",
      baseURL: "https://api.example.test",
      webOrigin: origin,
      signupsEnabled: "true",
      signupAllowlist: "",
      signupInvite: { code, limit },
      logger: { level: "error", log: () => {} },
    });
  const signUp = (auth: ReturnType<typeof createAuth>, email: string, cookie?: string) =>
    auth.handler(
      new Request("https://api.example.test/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          ...(cookie ? { cookie: `${SIGNUP_INVITE_COOKIE}=${cookie}` } : {}),
        },
        body: JSON.stringify({ email, password: "synthetic-password-123", name: "Beta" }),
      }),
    );
  const accounts = async () => {
    const users = await system.user.findMany({ select: { id: true, email: true } });
    const members = await system.spaceMember.findMany({ select: { userId: true } });
    return { users, members: new Set(members.map((m) => m.userId)) };
  };

  const code = randomBytes(24).toString("hex");
  const auth = authFor(code, 10);

  // Without the link, or with a wrong code, nothing is created.
  assert.equal((await signUp(auth, "nolink@example.invalid")).status, 400);
  assert.equal((await signUp(auth, "wrong@example.invalid", `${code}x`)).status, 400);
  assert.equal((await accounts()).users.length, 0);

  // Fourteen people race for ten places.
  const racers = Array.from({ length: 14 }, (_, i) => `beta-${i}@example.invalid`);
  const responses = await Promise.all(racers.map((email) => signUp(auth, email, code)));
  const admitted = responses.filter((response) => response.status === 200).length;
  assert.equal(admitted, 10, `admitted ${admitted}: ${responses.map((r) => r.status).join(",")}`);
  const redemptions = await system.signupInviteRedemption.findMany();
  assert.equal(redemptions.length, 10);
  assert.ok(redemptions.every((row) => row.inviteId === signupInviteId(code)));
  assert.ok(redemptions.every((row) => !row.inviteId.includes(code)));
  const after = await accounts();
  // Every admitted account received its workspace; nobody else did.
  assert.equal(after.members.size, 10);
  assert.ok(redemptions.every((row) => after.members.has(row.userId)));

  // Once full, a newcomer with the link is refused before any account row is written.
  const before = after.users.length;
  assert.equal((await signUp(auth, "late@example.invalid", code)).status, 400);
  assert.equal((await accounts()).users.length, before);

  // Admitted people still sign in without the link once the batch is full.
  const holder = after.users.find((user) => after.members.has(user.id))!;
  const signIn = await auth.handler(
    new Request("https://api.example.test/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email: holder.email, password: "synthetic-password-123" }),
    }),
  );
  assert.equal(signIn.status, 200);

  // A new code opens a new batch without moving the earlier places.
  const next = randomBytes(24).toString("hex");
  const nextAuth = authFor(next, 1);
  assert.equal((await signUp(nextAuth, "next@example.invalid", code)).status, 400);
  assert.equal((await signUp(nextAuth, "next@example.invalid", next)).status, 200);
  assert.equal((await signUp(nextAuth, "next2@example.invalid", next)).status, 400);
  assert.equal(await system.signupInviteRedemption.count({ where: { inviteId: signupInviteId(code) } }), 10);
  assert.equal(await system.signupInviteRedemption.count({ where: { inviteId: signupInviteId(next) } }), 1);

  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          "actual additive migration, hash-only check constraint, no row security",
          "signup without the link or with a wrong code creates no account",
          "14 concurrent real signups admit exactly 10 and bootstrap exactly those",
          "a full batch refuses before writing an account",
          "admitted accounts sign in without the link",
          "a new code starts a new batch and keeps earlier places",
        ],
        modelsCalled: 0,
        productionAccess: false,
      },
      null,
      2,
    ),
  );
} finally {
  if (db) {
    await db.prisma.$disconnect();
    await db.pool.end();
  }
  await postgres.stop();
}

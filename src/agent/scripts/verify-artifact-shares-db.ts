// Qualifies artifact share links (specs/artifact-share-links) against a fresh loopback
// PostgreSQL with the actual migration and a runtime role without superuser or RLS bypass.
// Synthetic data only; never point it at a real database.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Actor } from "@mycellios/contracts";
import { asSystem, createDb, IsolationError, LocalKeyProvider, runAsTenant } from "@mycellios/db";
import { createArtifactStore } from "@mycellios/adapters";
import EmbeddedPostgres from "embedded-postgres";
import {
  SHARED_ARTIFACT_CSP,
  artifactShareHttp,
  shareArtifact,
  unshareArtifact,
} from "../apps/api/src/artifact-shares.js";

process.env.RAKAZO_PROJECT_LOCAL = "1";
const socket = createServer();
await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as { port: number }).port;
await new Promise<void>((resolve) => socket.close(() => resolve()));
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-artifact-shares-"));
const password = randomBytes(24).toString("hex");
const database = new EmbeddedPostgres({
  databaseDir: path.join(directory, "pg"),
  port,
  user: "postgres",
  password,
  persistent: true,
  autoRehydrateSymlinks: true,
  onLog: () => {},
  onError: () => {},
});
let db: ReturnType<typeof createDb> | undefined;
const checks: string[] = [];
try {
  await database.initialise();
  await database.start();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await promisify(execFile)(
    process.execPath,
    [path.resolve("node_modules/prisma/build/index.js"), "db", "push", "--config", "packages/db/prisma.config.ts"],
    { windowsHide: true, env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url }, maxBuffer: 1024 * 1024 },
  );
  const sql = database.getPgClient();
  await sql.connect();
  try {
    // Recreate this table from its actual migration, not a db-push approximation.
    await sql.query("DROP TABLE artifact_shares CASCADE");
    await sql.query(await readFile("packages/db/prisma/migrations/20261120230000_artifact_shares/migration.sql", "utf8"));
    await sql.query(
      `CREATE ROLE share_test LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO share_test; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO share_test`,
    );
  } finally {
    await sql.end();
  }
  checks.push("actual migration applied to fresh loopback PostgreSQL; runtime role has no superuser or RLS bypass");

  db = createDb(`postgresql://share_test:${password}@127.0.0.1:${port}/postgres`, {
    encryptContent: true,
    keyProvider: new LocalKeyProvider([{ id: "synthetic", key: randomBytes(32) }]),
    applicationName: "artifact-shares-qualification",
  });
  const prisma = db.prisma;
  const system = asSystem(prisma, "synthetic artifact share fixtures");
  const org = randomUUID(), space = randomUUID();
  await system.organization.create({ data: { id: org, name: "Synthetic", slug: org, createdAt: new Date() } });
  await system.space.create({ data: { id: space, organizationId: org, name: "Synthetic" } });
  const owner = { userId: randomUUID(), spaceId: space } as Actor;
  const other = { userId: randomUUID(), spaceId: space } as Actor;
  for (const actor of [owner, other]) {
    await system.user.create({ data: { id: actor.userId, name: "Synthetic", email: `${actor.userId}@example.invalid` } });
    await system.member.create({ data: { id: randomUUID(), organizationId: org, userId: actor.userId, role: "member", createdAt: new Date() } });
    await system.spaceMember.create({ data: { id: randomUUID(), ...actor, organizationId: org, role: "member", createdAt: new Date() } });
  }

  const store = createArtifactStore(path.join(directory, "data"), prisma, {});
  const context = { operationId: "fixture", traceId: "fixture", spaceId: space, userId: owner.userId, botId: "fixture", signal: new AbortController().signal };
  async function artifact(html: string, root?: string, version = 1) {
    const bytes = new TextEncoder().encode(html);
    const stored = await store.put({ name: "report.html", mimeType: "text/html", bytes }, context);
    const id = randomUUID();
    await system.artifact.create({
      data: { id, spaceId: space, userId: owner.userId, name: "report.html", mimeType: "text/html", size: bytes.byteLength, hash: stored.hash, storageKey: stored.id, rootArtifactId: root ?? null, version },
    });
    return id;
  }
  const v1 = await artifact("<h1>version one</h1>");
  const v2 = await artifact("<h1>version two</h1>", v1, 2);
  const http = artifactShareHttp(prisma, store);
  const open = async (token: string) => {
    const response = await http.request(`/api/shared/${token}`);
    return { status: response.status, body: await response.text(), csp: response.headers.get("content-security-policy") };
  };

  const shared = await runAsTenant(owner, () => shareArtifact({ prisma }, owner, v1));
  assert.match(shared.token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(await open(shared.token), { status: 200, body: "<h1>version one</h1>", csp: SHARED_ARTIFACT_CSP });
  checks.push("a sessionless visitor opens exactly the shared version, sandboxed with no network");

  assert.deepEqual(await runAsTenant(other, () => prisma.artifactShare.findMany()), []);
  assert.deepEqual(await prisma.artifactShare.findMany(), []);
  await assert.rejects(runAsTenant(other, () => shareArtifact({ prisma }, other, v1)), IsolationError);
  await assert.rejects(runAsTenant(other, () => unshareArtifact({ prisma }, other, v1)), IsolationError);
  assert.equal((await open(shared.token)).status, 200);
  checks.push("another member of the same Space cannot see, create or revoke the owner's link; no context sees nothing");

  const moved = await runAsTenant(owner, () => shareArtifact({ prisma }, owner, v2));
  assert.equal(moved.token, shared.token);
  assert.equal((await open(shared.token)).body, "<h1>version two</h1>");
  checks.push("sharing a newer version keeps the address and moves it");

  await runAsTenant(owner, () => unshareArtifact({ prisma }, owner, v2));
  assert.equal((await open(shared.token)).status, 404);
  checks.push("revoking stops the address for everyone");

  const again = await runAsTenant(owner, () => shareArtifact({ prisma }, owner, v1));
  assert.notEqual(again.token, shared.token);
  await system.artifact.deleteMany({ where: { rootArtifactId: v1 } });
  await system.artifact.delete({ where: { id: v1 } });
  assert.equal(await system.artifactShare.count(), 0);
  assert.equal((await open(again.token)).status, 404);
  checks.push("a revoked address is never reissued, and deleting the artifact deletes its link");

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  try {
    await db?.prisma.$disconnect();
    await db?.pool.end();
  } finally {
    await database.stop();
  }
}

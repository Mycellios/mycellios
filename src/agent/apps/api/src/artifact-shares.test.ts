import type { PrismaClient } from "@mycellios/db";
import { IsolationError } from "@mycellios/db";
import { describe, expect, it, vi } from "vitest";
import {
  SHARED_ARTIFACT_CSP,
  artifactShareHttp,
  getArtifactShare,
  shareArtifact,
  sharedContentType,
  unshareArtifact,
} from "./artifact-shares.js";

const owner = { spaceId: "space-1", userId: "user-1" } as never;
const stranger = { spaceId: "space-1", userId: "user-2" } as never;

type ArtifactRow = { id: string; rootArtifactId: string | null; spaceId: string; userId: string; version: number; name: string; mimeType: string; storageKey: string; botId: string | null; groupId: string | null };
type ShareRow = { id: string; token: string; rootArtifactId: string; artifactId: string; spaceId: string; userId: string; updatedAt: Date };

function fakeDb(artifacts: ArtifactRow[]) {
  const shares: ShareRow[] = [];
  const withArtifact = (row: ShareRow) => ({ ...row, artifact: artifacts.find((a) => a.id === row.artifactId)! });
  const db = {
    artifact: {
      findFirst: vi.fn(async ({ where }: { where: Partial<ArtifactRow> }) =>
        artifacts.find((a) => a.id === where.id && a.spaceId === where.spaceId && a.userId === where.userId) ?? null,
      ),
    },
    artifactShare: {
      findUnique: vi.fn(async ({ where }: { where: { rootArtifactId?: string; token?: string } }) => {
        const row = shares.find((s) => (where.token ? s.token === where.token : s.rootArtifactId === where.rootArtifactId));
        return row ? withArtifact(row) : null;
      }),
      upsert: vi.fn(async ({ where, create, update }: { where: { rootArtifactId: string }; create: ShareRow; update: { artifactId: string } }) => {
        const existing = shares.find((s) => s.rootArtifactId === where.rootArtifactId);
        if (existing) Object.assign(existing, update, { updatedAt: new Date() });
        else shares.push({ ...create, updatedAt: new Date() });
        return withArtifact(existing ?? shares.at(-1)!);
      }),
      deleteMany: vi.fn(async ({ where }: { where: { rootArtifactId: string } }) => {
        const index = shares.findIndex((s) => s.rootArtifactId === where.rootArtifactId);
        if (index >= 0) shares.splice(index, 1);
        return { count: index >= 0 ? 1 : 0 };
      }),
    },
  };
  return { db: db as unknown as PrismaClient, shares };
}

const base = { spaceId: "space-1", userId: "user-1", botId: "bot-1", groupId: null, name: "Informe Q2.html", mimeType: "text/html", storageKey: "object:1" };
const family: ArtifactRow[] = [
  { ...base, id: "a1", rootArtifactId: null, version: 1 },
  { ...base, id: "a2", rootArtifactId: "a1", version: 2, storageKey: "object:2" },
];

describe("artifact share links", () => {
  it("creates one link per family that keeps its address and moves to the version shared", async () => {
    const { db } = fakeDb(family);
    expect(await getArtifactShare({ prisma: db }, owner, "a1")).toBeNull();
    const first = await shareArtifact({ prisma: db }, owner, "a1");
    expect(first).toMatchObject({ artifactId: "a1", version: 1 });
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const moved = await shareArtifact({ prisma: db }, owner, "a2");
    expect(moved).toMatchObject({ token: first.token, artifactId: "a2", version: 2 });
    expect(await getArtifactShare({ prisma: db }, owner, "a1")).toMatchObject({ token: first.token, version: 2 });
  });

  it("refuses anyone but the owner and revokes the whole family", async () => {
    const { db, shares } = fakeDb(family);
    await expect(shareArtifact({ prisma: db }, stranger, "a1")).rejects.toBeInstanceOf(IsolationError);
    await shareArtifact({ prisma: db }, owner, "a2");
    await expect(unshareArtifact({ prisma: db }, stranger, "a1")).rejects.toBeInstanceOf(IsolationError);
    await unshareArtifact({ prisma: db }, owner, "a1");
    expect(shares).toEqual([]);
  });

  it("renders only safe types inline and downloads the rest", () => {
    expect(sharedContentType("text/html")).toEqual({ type: "text/html; charset=utf-8", inline: true });
    expect(sharedContentType("text/markdown")).toEqual({ type: "text/plain; charset=utf-8", inline: true });
    expect(sharedContentType("application/pdf").inline).toBe(true);
    expect(sharedContentType("application/x-msdownload")).toEqual({ type: "application/octet-stream", inline: false });
    expect(sharedContentType("application/xhtml+xml").inline).toBe(false);
  });
});

describe("public share route", () => {
  const store = { get: vi.fn(async () => new TextEncoder().encode("<h1>Q2</h1>")), put: vi.fn(), remove: vi.fn() };

  it("serves the pinned version sandboxed, with no network and no session", async () => {
    const { db } = fakeDb(family);
    const { token } = await shareArtifact({ prisma: db }, owner, "a2");
    const response = await artifactShareHttp(db, store as never).request(`/api/shared/${token}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<h1>Q2</h1>");
    expect(store.get).toHaveBeenCalledWith("object:2", expect.objectContaining({ spaceId: "space-1", userId: "user-1" }));
    expect(response.headers.get("content-security-policy")).toBe(SHARED_ARTIFACT_CSP);
    expect(SHARED_ARTIFACT_CSP).toContain("connect-src 'none'");
    expect(SHARED_ARTIFACT_CSP).not.toContain("allow-same-origin");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("answers the same 404 for unknown, malformed and revoked links", async () => {
    const { db } = fakeDb(family);
    const { token } = await shareArtifact({ prisma: db }, owner, "a1");
    await unshareArtifact({ prisma: db }, owner, "a1");
    const app = artifactShareHttp(db, store as never);
    for (const path of [`/api/shared/${token}`, "/api/shared/not-a-token", `/api/shared/${"x".repeat(43)}`]) {
      const response = await app.request(path);
      expect(response.status).toBe(404);
      expect(response.headers.get("content-security-policy")).toBe(SHARED_ARTIFACT_CSP);
    }
  });
});

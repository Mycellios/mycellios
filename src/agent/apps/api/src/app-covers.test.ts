import { describe, expect, it, vi } from "vitest";
import type { Actor, AppCoverWrite } from "@rakazo/contracts";
import { getAppCover, setAppCover, validateAppCover } from "./app-covers.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const actor = { userId: "owner", spaceId: "space" } as Actor;
function fixture() {
  const rows: Array<Record<string, any>> = [];
  const files = new Map<string, Buffer>();
  const artifact = {
    findFirst: vi.fn(async ({ where, orderBy }: any) => {
      const found = rows.filter(row => Object.entries(where).every(([k,v]) => row[k] === v));
      return (orderBy ? found.sort((a,b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id)) : found)[0] ?? null;
    }),
    create: vi.fn(async ({ data }: any) => {
      const row = { ...data, id: `artifact-${rows.length + 1}`, runId: null, createdAt: new Date(rows.length * 1000) };
      rows.push(row); return row;
    }),
  };
  const hostedWeb={findFirst:vi.fn(async({where}:any)=>where.id==="owner-app"&&where.userId==="owner"&&where.spaceId==="space"?{id:"owner-app"}:null)};
  const prisma = { hostedWeb,artifact, $queryRaw: vi.fn(), $transaction: vi.fn(async (fn: any) => fn(prisma)) };
  const artifacts = {
    put: vi.fn(async ({ bytes }: any) => { const id = `file-${files.size}`; files.set(id, Buffer.from(bytes)); return { id }; }),
    get: vi.fn(async (id: string) => files.get(id)!),
    remove: vi.fn(async (id: string) => { files.delete(id); }),
  };
  return { rows, files, prisma, artifacts, deps: { prisma, artifacts } as unknown as Parameters<typeof setAppCover>[0] };
}
const upload = (revision: string | null = null): AppCoverWrite => ({ appId: "owner-app", botId: "mico",
  expectedRevision: revision, clientNonce: crypto.randomUUID(), source: { kind: "upload", mimeType: "image/png", contentBase64: png.toString("base64") } });
describe("creator-owned app covers", () => {
  it.each(["other-user","other-space","included-app"])("refuses %s before any file write or replay",async scenario=>{
    const f=fixture(),request=upload();
    const principal=scenario==="other-user"?{...actor,userId:"other"}:scenario==="other-space"?{...actor,spaceId:"other"}:actor;
    await expect(setAppCover(f.deps,principal,{...request,...(scenario==="included-app"?{appId:"video-studio"}:{})})).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(f.artifacts.put).not.toHaveBeenCalled();expect(f.prisma.artifact.create).not.toHaveBeenCalled();
  });
  it("stores a private cover and isolates user, Space and app reads", async () => {
    const f = fixture(); const result = await setAppCover(f.deps, actor, upload());
    expect(result.image?.contentBase64).toBe(png.toString("base64"));
    expect((await getAppCover(f.deps, { ...actor, userId: "other" }, "owner-app")).image).toBeNull();
    expect((await getAppCover(f.deps, { ...actor, spaceId: "other" }, "owner-app")).image).toBeNull();
    expect((await getAppCover(f.deps, actor, "other-app")).image).toBeNull();
  });
  it("replays the same save without another object and rejects nonce reuse for another app", async () => {
    const f = fixture(), request = upload();
    await setAppCover(f.deps, actor, request); await setAppCover(f.deps, actor, request);
    expect(f.artifacts.put).toHaveBeenCalledOnce();
    await expect(setAppCover(f.deps, actor, { ...request, appId: "other-app" })).rejects.toThrow();
  });
  it("preserves a newer choice and cleans the rejected upload", async () => {
    const f = fixture(); await setAppCover(f.deps, actor, upload());
    await expect(setAppCover(f.deps, actor, upload())).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.rows).toHaveLength(1); expect(f.artifacts.remove).toHaveBeenCalledOnce();
  });
  it("copies only an owned image belonging to the chosen Mico", async () => {
    const f = fixture();
    f.files.set("source", png);
    f.rows.push({ id: "source", userId: actor.userId, spaceId: actor.spaceId, botId: "other-mico",
      groupId: null, runId: "run", name: "generated.png", mimeType: "image/png", storageKey: "source", createdAt: new Date() });
    const request: AppCoverWrite = { ...upload(), source: { kind: "artifact", artifactId: "source" } };
    await expect(setAppCover(f.deps, actor, request)).rejects.toThrow();
    await expect(setAppCover(f.deps, { ...actor, userId: "other" }, { ...request, botId: "other-mico" })).rejects.toThrow();
    expect(f.artifacts.put).not.toHaveBeenCalled();
    expect((await setAppCover(f.deps, actor, { ...request, botId: "other-mico" })).image).not.toBeNull();
  });
  it("restores the default without deleting the previous version", async () => {
    const f = fixture(); const prior = await setAppCover(f.deps, actor, upload());
    const result = await setAppCover(f.deps, actor, { ...upload(prior.revision), source: { kind: "default" } });
    expect(result.image).toBeNull(); expect(result.revision).not.toBe(prior.revision);
    expect(f.rows).toHaveLength(2); expect(f.rows[1]?.rootArtifactId).toBe(prior.revision);
  });
  it("rejects SVG, MIME spoofing and oversized data before storage", async () => {
    expect(() => validateAppCover(Buffer.from("<svg/>"), "image/png")).toThrow();
    expect(() => validateAppCover(png, "image/svg+xml")).toThrow();
    expect(() => validateAppCover(Buffer.alloc(8 * 1024 * 1024 + 1), "image/png")).toThrow();
    const f = fixture(); await expect(setAppCover(f.deps, actor, { ...upload(), source: { kind: "upload", mimeType: "image/png", contentBase64: "<html>" } })).rejects.toThrow();
    expect(f.artifacts.put).not.toHaveBeenCalled();
  });
});

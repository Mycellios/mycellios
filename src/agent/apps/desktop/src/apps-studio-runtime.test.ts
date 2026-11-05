import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppsStudioRuntime, studioScopeKey } from "./apps-studio-runtime.js";
import type { StudioProject } from "../../../packages/contracts/src/app-studio.js";

const scope = { owner: "owner-a", space: "space-a", server: "https://www.mycellios.com/agent" };
const scenes = Array.from({ length: 6 }, (_, i) => ({
  title: `Escena ${i + 1}`,
  narration: "Una narración de prueba que se conserva exactamente como datos, sin ejecutar código.",
}));
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(command?: ConstructorParameters<typeof AppsStudioRuntime>[1]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-test-"));
  roots.push(root);
  const runtime = new AppsStudioRuntime(root, command);
  const p = (await runtime.request(scope, {
    action: "create",
    topic: "Tema de prueba",
  })) as StudioProject;
  return { root, runtime, p };
}
describe("Apps native project authority", () => {
  it("persists the exact definition and isolates owner, Space and server", async () => {
    const { root, runtime, p } = await fixture();
    for (const other of [
      { ...scope, owner: "b" },
      { ...scope, space: "b" },
      { ...scope, server: "https://other.test" },
    ]) {
      expect(await runtime.request(other, { action: "list" })).toEqual({ projects: [] });
      await expect(
        runtime.request(other, { action: "artifact", id: p.id, kind: "video" }),
      ).rejects.toThrow();
    }
    const restarted = new AppsStudioRuntime(root);
    expect(await restarted.request(scope, { action: "list" })).toEqual({ projects: [p] });
    expect(p.definitionHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects paths, arbitrary commands and unknown request fields", async () => {
    const { runtime, p } = await fixture();
    await expect(
      runtime.request(scope, { action: "artifact", id: "../outside", kind: "video" }),
    ).rejects.toThrow();
    await expect(
      runtime.request(scope, {
        action: "render",
        id: p.id,
        revision: 1,
        command: "echo bad",
      } as never),
    ).rejects.toThrow();
  });
  it("rejects stale writes and invalidates old media on a script revision", async () => {
    const { runtime, p } = await fixture();
    const changed = (await runtime.request(scope, {
      action: "save",
      id: p.id,
      revision: 1,
      scenes,
    })) as StudioProject;
    expect(changed.revision).toBe(2);
    expect(changed.voiceRevision).toBeNull();
    expect(changed.previewRevision).toBeNull();
    expect(changed.approvedRevision).toBeNull();
    await expect(
      runtime.request(scope, { action: "save", id: p.id, revision: 1, scenes }),
    ).rejects.toThrow(/cambiado/);
  });
  it("requires real revision-bound voice, frames and review before render", async () => {
    const { runtime, p } = await fixture();
    await expect(
      runtime.request(scope, { action: "approve", id: p.id, revision: 1 }),
    ).rejects.toThrow(/Genera/);
    await expect(
      runtime.request(scope, { action: "render", id: p.id, revision: 1 }),
    ).rejects.toThrow(/Aprueba/);
    await expect(
      runtime.request(scope, {
        action: "preview",
        id: p.id,
        revision: 1,
        frames: Array(6).fill("data:image/png;base64,AAAA"),
      }),
    ).rejects.toThrow();
  });
  it("never returns private artifacts after authority is revoked", async () => {
    const { runtime, p } = await fixture();
    await expect(
      runtime.request(scope, { action: "save", id: p.id, revision: 1, scenes }, async () => false),
    ).rejects.toThrow(/sesión/);
  });
  it("does not silently upgrade a persisted project", async () => {
    const { root, runtime, p } = await fixture();
    const file = path.join(root, studioScopeKey(scope), p.id, "project.json");
    const stored = JSON.parse(await readFile(file, "utf8"));
    stored.appVersion = "9.0.0";
    await writeFile(file, JSON.stringify(stored));
    await expect(runtime.request(scope, { action: "list" })).rejects.toThrow(/versión original/);
  });
  it("reports an interrupted session without replaying work or overwriting a receipt during a read", async () => {
    const { root, p } = await fixture();
    const file = path.join(root, studioScopeKey(scope), p.id, "project.json");
    const stored = { ...p, activeStep: { action: "render", startedAt: p.createdAt } };
    await writeFile(file, JSON.stringify(stored));
    const runtime = new AppsStudioRuntime(root, async () => { throw new Error("must not execute"); });
    const result = await runtime.request(scope, { action: "list" });
    expect(result).toMatchObject({ projects: [{ id: p.id, status: "interrupted" }] });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(stored);
  });
  it("reconciles a completed structured script rather than submitting it to Codex twice", async () => {
    const { root, p } = await fixture();
    await writeFile(path.join(root, studioScopeKey(scope), p.id, "script-output.json"), JSON.stringify({ scenes }));
    const runtime = new AppsStudioRuntime(root, async () => { throw new Error("must not resubmit"); });
    const result = await runtime.request(scope, { action: "script", id: p.id, revision: 1 });
    expect(result).toMatchObject({ scenes, status: "script", revision: 2 });
  });
  it("locks concurrent mutation for a project without blocking another project", async () => {
    let release!: () => void;
    const { runtime, p } = await fixture();
    const pending = runtime.request(
      scope,
      { action: "save", id: p.id, revision: 1, scenes },
      () =>
        new Promise((resolve) => {
          release = () => resolve(true);
        }),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    await expect(
      runtime.request(scope, { action: "save", id: p.id, revision: 1, scenes }),
    ).rejects.toThrow(/curso/);
    expect(
      await runtime.request(scope, { action: "create", topic: "Otro proyecto" }),
    ).toHaveProperty("id");
    release();
    // Second authority check also waits; avoid a synthetic dangling authorization fixture.
    await new Promise((resolve) => setTimeout(resolve, 25));
    release();
    await pending;
  });
});
